import {
  ArkBatch,
  ArkOperator,
  ArkVirtualTx,
  ArkVtxo,
} from './ark.types';
import config from '../../config';
import bitcoinClient from '../bitcoin/bitcoin-client';
import { ArkNativeSource, ArkNativeSourceError, arkNativeSourceFromEnvironment } from './ark-native-source';

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

const aspUnavailable =
  'Ark observations are unavailable. Operator, batch, VTXO and virtual-transaction reads require the owned Ark service provider (arkd) with its Bitcoin anchor reader, which is not connected on this deployment.';

/**
 * Ark operator, round, VTXO and virtual-mempool evidence.
 *
 * Provider identity comes from an explicitly selected native Arkade reader and
 * an independent Bitcoin checkpoint. Inventory, batch and proof reads still
 * require their owning projections and verifier; a provider response alone
 * cannot establish those facts. Unsupported reads retain their unavailable boundary.
 */
export class ArkService {
  private nativeSource: ArkNativeSource | null | undefined;
  constructor(private readonly options: { nativeSource?: ArkNativeSource | null } = {}) {}
  /* IMPLEMENTATION-HANDOFF [WP-BE-006]
   * Defect BE-006; COV-BE-006 operators, batches/list/detail, VTXO detail,
   * virtual transactions and proof verification. All six offered operations
   * require provider observations, inventory projections and real exit proofs.
   * Provider identity is connected; the remaining five journeys are not complete.
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
   * This preparation comment does not connect a provider or implement a fix.
   */
  /** @asyncSafe */
  public async $getOperators(): Promise<ArkOperator[]> {
    try {
      if (this.nativeSource === undefined) {
        this.nativeSource = this.options.nativeSource !== undefined ? this.options.nativeSource : arkNativeSourceFromEnvironment(
          config.MEMPOOL.NETWORK, (method, params, signal) => bitcoinClient.rpc.call(method, params, { signal }));
      }
      if (!this.nativeSource) throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
      const { observation } = await this.nativeSource.observe();
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
  public async $getBatches(): Promise<ArkBatch[]> {
    throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
  }

  /** @asyncSafe */
  public async $getBatch(_batchId: string): Promise<ArkBatch | null> {
    throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
  }

  /** @asyncSafe */
  public async $getVtxo(_vtxoId: string): Promise<ArkVtxo | null> {
    throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
  }

  /** @asyncSafe */
  public async $getVirtualTxs(): Promise<ArkVirtualTx[]> {
    throw new ArkEvidenceError('unavailable-ark-provider', aspUnavailable);
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
      error: 'The Ark exit proof verifier (owned arkd) and Bitcoin anchor reader are not connected. No VTXO tree path or batch root was verified.',
    };
  }
}

export const arkService = new ArkService();
