import {
  ArkBatch,
  ArkOperator,
  ArkVirtualTx,
  ArkVtxo,
} from './ark.types';
import config from '../../config';
import bitcoinClient from '../bitcoin/bitcoin-client';
import { ArkNativeSource, ArkNativeSourceError, arkNativeSourceFromEnvironment } from './ark-native-source';
import { ArkNativeProofVerdict, verifyArkNativeProof } from './ark-native-proof';
import { ownedWorkbenchCore, WorkbenchCoreReader } from '../intelligence/workbench/workbench-core';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class ArkEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

export interface ArkProofVerdict {
  readonly valid: boolean;
  readonly stage: 'invalid-input' | 'unavailable-verifier';
  readonly error: string;
}

export interface ArkBatchWindow { after?: unknown; before?: unknown; limit?: unknown; }
const batchFailure = () => new ArkEvidenceError('unavailable-ark-projection', 'The bounded completed-round observation could not be validated.');
const decimal = /^(?:0|[1-9][0-9]{0,11})$/;
export function arkBatchWindow(input: ArkBatchWindow = {}): { after: string; before: string; limit: number } {
  const after = input.after === undefined ? '0' : input.after;
  const before = input.before === undefined ? String(Math.floor(Date.now() / 1000) + 1) : input.before;
  const limit = input.limit === undefined ? '10' : input.limit;
  if (typeof after !== 'string' || typeof before !== 'string' || typeof limit !== 'string'
    || !decimal.test(after) || !decimal.test(before) || BigInt(after) >= BigInt(before)
    || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(limit)) {
    throw new ArkEvidenceError('invalid-ark-batch-window', 'A scalar after/before timestamp interval and limit 1..100 are required.', 400);
  }
  return { after, before, limit: Number(limit) };
}

const aspUnavailable =
  'Ark provider identity is unavailable. A selected native Ark provider and its independent Bitcoin anchor reader are required.';

const projectionUnavailable =
  'The verified Ark batch, VTXO and virtual-transaction projections are unavailable on this deployment. Observed provider identity alone does not establish their inventory or proofs.';

/**
 * Ark operator, round, VTXO and virtual-mempool evidence.
 *
 * Provider identity comes from an explicitly selected native Arkade reader and
 * an independent Bitcoin checkpoint. A bounded native round window includes
 * completed summaries without inventing catalogue completeness, confirmation,
 * amounts or roots. Detail and proof reads still require their owning native
 * projections and verifier. Unsupported reads retain their unavailable boundary.
 */
export class ArkService {
  private nativeSource: ArkNativeSource | null | undefined;
  constructor(private readonly options: { nativeSource?: ArkNativeSource | null; core?: WorkbenchCoreReader } = {}) {}
  private source(): ArkNativeSource {
    if (this.nativeSource === undefined) {
      this.nativeSource = this.options.nativeSource !== undefined ? this.options.nativeSource : arkNativeSourceFromEnvironment(
        config.MEMPOOL.NETWORK, (method, params, signal) => bitcoinClient.rpc.call(method, params, { signal }));
    }
    if (!this.nativeSource) throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
    return this.nativeSource;
  }
  /* IMPLEMENTATION-HANDOFF [WP-BE-006]
   * Defect BE-006; COV-BE-006 operators, batches/list/detail, VTXO detail,
   * virtual transactions and proof verification. All six offered operations
   * require provider observations, inventory projections and real exit proofs.
   * Provider identity and bounded completed summaries are connected; all six
   * complete API-to-UI/lifecycle journeys still require actual acceptance.
   * 1. Resolve the operated provider identity, Ark dialect, supported network
   *    and exact arkd/API revision. R-BE-ARK points to the retrieved official
   *    implementation; its current branch is not evidence of the deployed
   *    version or a production approval. Pin and assess the actual release.
   * 2. Add an injected, bounded owned-arkd reader with TLS/authentication and
   *    pagination. Map provider, batch, VTXO and virtual-transaction fields
   *    from protocol responses, preserving exact amounts and their status.
   *    Respect provider indexer exposure/intent rules; expose no wallet keys.
   * 3. Reuse intelligence/ark-vpack anchor-reader, dialect-translator and
   *    reconstruction instead of a second proof engine. Bind proof bytes,
   *    VTXO outpoint, batch root, expiry and spend state to the same provider
   *    and owned Bitcoin checkpoint. The hash-array request alone is not a
   *    complete exit proof: version the model and consumer input accordingly.
   * 4. Update ark.types/routes and frontend ark dashboard/VTXO detail;
   *    routes currently map every non-input verdict to 503, so add explicit
   *    completed valid/invalid verdict handling after real verification.
   * 5. Test genuine provider batches/VTXOs on supported Signet, spent/expired
   *    outputs, wrong dialect/network, malformed/altered proof, pagination,
   *    provider outage/restart and Bitcoin reorg. Regress the VPACK tools.
   * Acceptance: all six real API-to-UI journeys pass with pinned evidence;
   * retain truthful unavailable states until the actual dependency works.
   * Rollback: preserve provider/index checkpoints and restore matched client/
   * protocol versions; no mainnet test transfer is required or authorized here.
   * Completed summaries are observations, not cryptographic or exit proofs.
   */
  /** @asyncSafe */
  public async $getOperators(): Promise<ArkOperator[]> {
    try {
      const { observation } = await this.source().observe();
      return [{ id: observation.profile.providerId, name: observation.profile.providerName, aspPubkey: observation.info.signerPubkey,
        roundIntervalSec: null, currentBatchHeight: null, activeVtxoCount: null, totalVolumeSats: null, status: 'observed',
        providerVersion: observation.info.version, sessionDurationSeconds: observation.info.sessionDurationSeconds, source: observation }];
    } catch (error) {
      if (error instanceof ArkEvidenceError) throw error;
      if (error instanceof ArkNativeSourceError) throw new ArkEvidenceError(error.code, error.message, error.status);
      throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
    }
  }

  /** @asyncSafe */
  public async $getBatches(input: ArkBatchWindow = {}): Promise<ArkBatch[]> {
    return (await this.$getBatchPage(input)).batches;
  }

  /** @asyncSafe A native bounded window includes ongoing rounds; only ended successful rounds become batches. */
  public async $getBatchPage(input: ArkBatchWindow = {}): Promise<{ batches: ArkBatch[]; nativeObservedCount: number }> {
    const window = arkBatchWindow(input);
    try {
      const source = this.source();
      const { observation, payload } = await source.observe(
        `/v1/admin/rounds?after=${window.after}&before=${window.before}&limit=${window.limit}&withCompleted=true`, true);
      if (!payload || !Array.isArray(payload.rounds) || !Array.isArray(payload.summaries)
        || payload.rounds.length !== payload.summaries.length || payload.rounds.length > window.limit
        || new Set(payload.rounds).size !== payload.rounds.length) throw batchFailure();
      let previousStart: bigint | null = null;
      const batches: ArkBatch[] = [];
      payload.summaries.forEach((row: any, index: number) => {
        if (!row || typeof row.roundId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.roundId)
          || row.roundId !== payload.rounds[index]
          || typeof row.startedAt !== 'string' || typeof row.endedAt !== 'string'
          || !decimal.test(row.startedAt) || !decimal.test(row.endedAt)
          || BigInt(window.after) !== 0n && BigInt(row.startedAt) <= BigInt(window.after)
          || BigInt(row.startedAt) >= BigInt(window.before)
          || typeof row.ended !== 'boolean' || row.failed !== false || typeof row.swept !== 'boolean'
          || typeof row.totalIntents !== 'string' || !/^(?:0|[1-9][0-9]{0,19})$/.test(row.totalIntents)) throw batchFailure();
        const start = BigInt(row.startedAt);
        if (previousStart !== null && start > previousStart) throw batchFailure();
        previousStart = start;
        if (!row.ended) return;
        if (row.stage !== 'FINALIZATION_STAGE' || start > BigInt(row.endedAt)
          || typeof row.commitmentTxid !== 'string' || !/^[0-9a-f]{64}$/.test(row.commitmentTxid)) throw batchFailure();
        batches.push({ batchId: row.roundId, operatorId: observation.profile.providerId, anchorTxid: row.commitmentTxid,
          rootHash: null, vtxoCount: null, totalAmountSats: null, roundTimestamp: Number(row.startedAt),
          endedAt: Number(row.endedAt), expirationTimestamp: null,
          status: row.swept ? 'swept' : 'observed-completed', nativeStage: row.stage, confirmation: null, source: observation });
      });
      return { batches, nativeObservedCount: payload.summaries.length };
    } catch (error) {
      if (error instanceof ArkEvidenceError) throw error;
      if (error instanceof ArkNativeSourceError) throw new ArkEvidenceError(error.code, error.message, error.status);
      throw batchFailure();
    }
  }

  /** @asyncSafe */
  public async $getBatch(batchId: string): Promise<ArkBatch | null> {
    if (typeof batchId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId)) {
      throw new ArkEvidenceError('invalid-ark-batch-id', 'A native round UUID is required.', 400);
    }
    try {
      const { observation, payload: row } = await this.source().observe('/v1/admin/round/' + batchId, true);
      if (!row || row.roundId !== batchId || typeof row.commitmentTxid !== 'string' || !/^[0-9a-f]{64}$/.test(row.commitmentTxid)
        || typeof row.startedAt !== 'string' || typeof row.endedAt !== 'string' || !decimal.test(row.startedAt) || !decimal.test(row.endedAt)
        || BigInt(row.startedAt) > BigInt(row.endedAt) || row.stage !== 'FINALIZATION_STAGE' || row.ended !== true
        || row.failed !== false || typeof row.swept !== 'boolean' || !Array.isArray(row.outputsVtxos) || row.outputsVtxos.length > 100000
        || row.outputsVtxos.some((value: unknown) => typeof value !== 'string' || !/^[0-9a-f]{64}:(?:0|[1-9][0-9]{0,9})$/.test(value)
          || Number(value.split(':')[1]) > 0xffffffff) || new Set(row.outputsVtxos).size !== row.outputsVtxos.length
        || typeof row.totalVtxosAmount !== 'string' || !/^(?:0|[1-9][0-9]{0,19})(?:\.[0-9]{1,8})?$/.test(row.totalVtxosAmount)) throw batchFailure();
      const [whole, fraction = ''] = row.totalVtxosAmount.split('.');
      const amount = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
      if (amount > 18446744073709551615n) throw batchFailure();
      return { batchId, operatorId: observation.profile.providerId, anchorTxid: row.commitmentTxid, rootHash: null,
        vtxoCount: row.outputsVtxos.length, totalAmountSats: amount.toString(), roundTimestamp: Number(row.startedAt),
        endedAt: Number(row.endedAt), expirationTimestamp: null, status: row.swept ? 'swept' : 'observed-completed',
        nativeStage: row.stage, confirmation: null, source: observation };
    } catch (error) {
      if (error instanceof ArkEvidenceError) throw error;
      if (error instanceof ArkNativeSourceError) throw new ArkEvidenceError(error.code, error.message, error.status);
      throw batchFailure();
    }
  }

  /** @asyncSafe */
  public async $getVtxo(_vtxoId: string): Promise<ArkVtxo | null> {
    throw new ArkEvidenceError('unavailable-ark-projection', projectionUnavailable);
  }

  /** @asyncSafe */
  public async $getVirtualTxs(): Promise<ArkVirtualTx[]> {
    throw new ArkEvidenceError('unavailable-ark-projection', projectionUnavailable);
  }

  /** @asyncSafe */
  public async $verifyProof(vtxoId: unknown, proofPath: unknown): Promise<ArkProofVerdict> {
    if (typeof vtxoId !== 'string' || !vtxoId.trim()
      || !Array.isArray(proofPath) || proofPath.length === 0
      || !proofPath.every(hash => typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash))) {
      return { valid: false, stage: 'invalid-input', error: 'A VTXO ID and a nonempty array of 32-byte hexadecimal proof path hashes are required.' };
    }
    return {
      valid: false, stage: 'unavailable-verifier',
      error: 'The Ark exit proof verifier is unavailable. No VTXO tree path, batch root or Bitcoin anchor was verified.',
    };
  }

  /** @asyncSafe Native verification establishes the returned scope, never unilateral exit viability. */
  public async $verifyNativeProof(raw: unknown): Promise<ArkNativeProofVerdict> {
    const scope = 'No native membership, signature or exit proof was established.';
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as any).schema !== 'universe-ark-native-proof-v1') {
      return { schema: 'universe-ark-native-proof-verdict-v1', valid: false, stage: 'invalid-native-proof',
        exitViable: null, protocolVerified: null, error: 'Supply a complete versioned native proof; a hash array is not a proof.', scope };
    }
    try {
      return await verifyArkNativeProof(raw, { source: this.source(), core: this.options.core || ownedWorkbenchCore });
    } catch (error) {
      return { schema: 'universe-ark-native-proof-verdict-v1', valid: null, stage: 'unavailable-native-verifier',
        exitViable: null, protocolVerified: null, error: error instanceof ArkEvidenceError ? error.message : 'The configured native verifier is unavailable.', scope };
    }
  }
}

export const arkService = new ArkService();
