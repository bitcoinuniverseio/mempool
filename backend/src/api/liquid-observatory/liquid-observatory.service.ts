import { createHash } from 'crypto';
import { configuredLiquidPairProfile, LiquidPairedSource } from './liquid-paired-source';
import { LiquidProjectionEngine, LiquidProjectionSnapshot } from './liquid-projection-engine';
import { LiquidProjectionStore } from './liquid-projection-store';
import { LiquidRegistryReader } from './liquid-registry-publication';
import { LiquidObservatoryEvidenceError } from './liquid-evidence-error';
import { LiquidAssetPage, LiquidAssetRecord, LiquidFederationEpoch, LiquidObservatoryCoverage, LiquidObservatorySummary, LiquidPegOutRecord, LiquidPegPage, LiquidPegRecord } from './liquid-observatory.types';
export { LiquidObservatoryEvidenceError } from './liquid-evidence-error';

/** Canonical public observations; opaque amounts and unpublished identities remain unknown. */
export class LiquidObservatoryService {
  /* IMPLEMENTATION-HANDOFF [WP-BE-010]
   * Defect BE-010; COV-BE-010 summary, assets/list/detail, pegs, federation.
   * Historical preparation finding: these five methods unconditionally failed
   * while the separate /node had an elements-node-source. Its success cannot complete
   * the five different observatory consumers. Source reproducer confirms it.
   * 1. Reuse elements-node-source and the existing liquid/elements-parser
   *    evidence plus an operated registry mirror. Pin Elements/Liquid rules,
   *    registry provenance and both Bitcoin/Elements network identities
   *    against R-BE-LIQUID; Liquid's chain identity is not Bitcoin mainnet.
   * 2. Define durable checkpointed projections for peg-ins/outs and federation
   *    epochs using actual scripts, amounts, confirmations and dynafed data.
   *    Keep opaque commitments opaque; never invent blinded asset amounts or
   *    identity labels that chain/registry evidence cannot establish.
   * 3. Implement bounded injected reads, exact atomic string values, asset-ID
   *    validation and pagination. Join peg evidence only at compatible owned
   *    Bitcoin and Elements checkpoints; record reorg/restart invalidation.
   * 4. Wire liquid-observatory types/routes and frontend summary, assets, pegs
   *    and federation. Preserve confidential-proof/unblinding tools and /node;
   *    one operational node panel is not full observatory acceptance.
   * 5. Test all five journeys on Liquid testnet or justified Elements regtest:
   *    actual issuance/peg observations, unknown asset, registry outage,
   *    invalid commitment, epoch changes, chain mismatch, restart and reorg.
   * Acceptance: all offered observations trace to real evidence with precise
   * amounts/status; no default constants or false empty collections.
   * Rollback: apply WP-BE-002 migration safeguards, retain raw peg/epoch data
   * and restore matched schema/adapters at the last verified checkpoint.
   * Marker retained pending full acceptance. Scoped paired-source/public-projection bodies now exist; federation payouts and whole offered coverage are not inferred.
   */
  constructor(private readonly injected?: { engine: Pick<LiquidProjectionEngine, 'snapshot' | 'advance'>; registry: Pick<LiquidRegistryReader, 'read'> }) {}
  private engine(): Pick<LiquidProjectionEngine, 'snapshot' | 'advance'> {
    if (this.injected) return this.injected.engine;
    const source = new LiquidPairedSource(configuredLiquidPairProfile());
    const file = process.env.UNIVERSE_LIQUID_PROJECTION_FILE;
    if (!file) throw new LiquidObservatoryEvidenceError('unavailable-elements-projection', 'The operator-owned durable Liquid projection is not configured.');
    return new LiquidProjectionEngine(source, new LiquidProjectionStore(file, createHash('sha256').update(JSON.stringify(source.profile)).digest('hex')));
  }
  private registry(): Pick<LiquidRegistryReader, 'read'> {
    if (this.injected) return this.injected.registry;
    if (!process.env.UNIVERSE_LIQUID_REGISTRY_PUBLICATION_FILE) throw new LiquidObservatoryEvidenceError('unavailable-asset-registry', 'The operator-published Liquid catalog is not configured.');
    return new LiquidRegistryReader();
  }
  private coverage(snapshot: LiquidProjectionSnapshot): LiquidObservatoryCoverage {
    const last = snapshot.state.blocks[snapshot.state.blocks.length - 1];
    return { schemaVersion: 'universe-liquid-observatory-v1', status: snapshot.status, source: snapshot.observation,
      progress: snapshot.progress, cursor: { height: last?.height ?? -1, blockHash: last?.hash ?? null },
      scope: 'canonical-public-blocks-and-parent-peg-evidence' };
  }
  private page(offset: number, limit: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new LiquidObservatoryEvidenceError('invalid-liquid-pagination', 'Offset must be 0..100000 and limit 1..100.', 400);
    }
  }
  private pegs(snapshot: LiquidProjectionSnapshot): LiquidPegRecord[] {
    return snapshot.verifiedPegInputs.map<LiquidPegRecord>(peg => {
      const block = snapshot.state.blocks.find(value => value.pegInputs.some(input => input.txid === peg.txid && input.vin === peg.vin));
      if (!block) throw new LiquidObservatoryEvidenceError('invalid-liquid-projection', 'The verified parent proof has no matching projected claim.');
      return { ...peg, id: peg.txid + ':' + peg.vin, type: 'peg-in', liquidTxid: peg.txid, liquidVin: peg.vin,
        amountSats: peg.amountAtomic, status: 'confirmed', confirmations: snapshot.observation.elements.height - block.height + 1,
        timestamp: block.time, liquidBlockHash: block.hash, liquidBlockHeight: block.height, federationWitnessAddress: null };
    }).sort((a, b) => b.liquidBlockHeight - a.liquidBlockHeight || a.id.localeCompare(b.id));
  }
  /** @asyncUnsafe */
  public async $getProjection(signal: AbortSignal = AbortSignal.timeout(15000)): Promise<LiquidObservatoryCoverage> {
    return this.coverage(await this.engine().snapshot(signal));
  }
  /** Explicit one-page continuation; cancellation cannot commit partial acquisition. @asyncUnsafe */
  public async $advanceProjection(height: number, hash: string | null, signal: AbortSignal = AbortSignal.timeout(15000)): Promise<LiquidObservatoryCoverage> {
    return this.coverage(await this.engine().advance(height, hash, signal));
  }
  /** @asyncUnsafe */
  public async $getSummary(signal: AbortSignal = AbortSignal.timeout(15000)): Promise<LiquidObservatorySummary> {
    const snapshot = await this.engine().snapshot(signal), observation = snapshot.observation;
    return { coverage: this.coverage(snapshot), blockHeight: observation.elements.height, blockHash: observation.elements.hash,
      dynamicFederation: { currentEpoch: Math.floor(observation.elements.height / observation.elements.epochLength),
        signersOnline: null, totalSigners: null, blockSigningThreshold: null, parametersRoot: observation.elements.parametersRoot },
      peggedReserveSats: null, activeAssetCount: null, confidentialTxPercentage: null,
      observedIssuanceCount: snapshot.state.blocks.reduce((count, block) => count + block.issuances.length, 0),
      observedOutputCounts: { confidential: snapshot.state.blocks.reduce((count, block) => count + block.confidentialOutputs, 0),
        explicit: snapshot.state.blocks.reduce((count, block) => count + block.explicitOutputs, 0), scope: 'projected-public-outputs', amountsUnknown: true },
      recentPegs: this.pegs(snapshot).slice(0, 10) };
  }
  /** @asyncUnsafe */
  public async $getAssets(offset = 0, limit = 100, signal: AbortSignal = AbortSignal.timeout(15000)): Promise<LiquidAssetPage> {
    this.page(offset, limit);
    const reader = this.registry(), snapshot = await this.engine().snapshot(signal), catalog = await reader.read(snapshot, signal);
    const coverage = this.coverage(snapshot), publication = { revision: catalog.publicationRevision, sha256: catalog.sha256, scope: catalog.scope };
    const assets: LiquidAssetRecord[] = catalog.assets.slice(offset, offset + limit).map(entry => {
      const issuance = snapshot.state.blocks.flatMap(block => block.issuances).find(value => !value.isReissuance && value.asset === entry.assetId && value.txid === entry.issuanceTxid && value.vin === entry.issuanceVin);
      if (!issuance) throw new LiquidObservatoryEvidenceError('invalid-asset-registry', 'A catalog entry lacks canonical public issuance evidence.');
      return { ...entry, coverage, publication, initialIssuanceAmountAtomic: issuance.assetAmountAtomic,
        initialIssuanceAmountCommitment: issuance.assetAmountCommitment, circulatingAmount: null, issuerPubkey: null, hasProof: true };
    });
    return { coverage, publication, assets, total: catalog.assets.length, offset, limit,
      nextOffset: offset + assets.length < catalog.assets.length ? offset + assets.length : null };
  }
  /** A negative lookup is scoped to the explicit publication, never a global nonexistence claim. @asyncUnsafe */
  public async $getAsset(assetId: string, signal: AbortSignal = AbortSignal.timeout(15000)): Promise<LiquidAssetRecord | null> {
    const reader = this.registry();
    if (typeof assetId !== 'string' || !/^[0-9a-f]{64}$/.test(assetId)) throw new LiquidObservatoryEvidenceError('invalid-liquid-asset-id', 'A lowercase 32-byte hexadecimal asset identifier is required.', 400);
    const snapshot = await this.engine().snapshot(signal), catalog = await reader.read(snapshot, signal);
    const entry = catalog.assets.find(value => value.assetId === assetId);
    if (!entry) {
      if (snapshot.status !== 'COMPLETE_AT_OBSERVED_PAIR') throw new LiquidObservatoryEvidenceError('incomplete-asset-registry-proof', 'A negative asset lookup requires the completed canonical projection.', 409);
      return null;
    }
    const issuance = snapshot.state.blocks.flatMap(block => block.issuances).find(value => !value.isReissuance && value.asset === entry.assetId && value.txid === entry.issuanceTxid && value.vin === entry.issuanceVin);
    if (!issuance) throw new LiquidObservatoryEvidenceError('invalid-asset-registry', 'A catalog entry lacks canonical public issuance evidence.');
    return { ...entry, coverage: this.coverage(snapshot),
      publication: { revision: catalog.publicationRevision, sha256: catalog.sha256, scope: catalog.scope },
      initialIssuanceAmountAtomic: issuance.assetAmountAtomic, initialIssuanceAmountCommitment: issuance.assetAmountCommitment,
      circulatingAmount: null, issuerPubkey: null, hasProof: true };
  }
  /** @asyncUnsafe */
  public async $getPegs(offset = 0, limit = 100, signal: AbortSignal = AbortSignal.timeout(15000)): Promise<LiquidPegPage> {
    this.page(offset, limit);
    const snapshot = await this.engine().snapshot(signal), all = this.pegs(snapshot), pegs = all.slice(offset, offset + limit);
    const requests = snapshot.state.blocks.flatMap(block => block.pegOutputs.filter(output => output.parentGenesis === snapshot.observation.parent.genesis
      && output.asset === snapshot.observation.profile.policyAsset).map<LiquidPegOutRecord>(output => ({ ...output,
      id: output.txid + ':' + output.vout, type: 'peg-out', status: 'request-confirmed',
      confirmations: snapshot.observation.elements.height - block.height + 1, liquidBlockHash: block.hash,
      liquidBlockHeight: block.height, timestamp: block.time, parentPayoutStatus: 'UNKNOWN', bitcoinTxid: null })))
      .sort((a, b) => b.liquidBlockHeight - a.liquidBlockHeight || a.id.localeCompare(b.id));
    return { coverage: this.coverage(snapshot), pegs, total: all.length, offset, limit,
      nextOffset: offset + pegs.length < all.length ? offset + pegs.length : null,
      pegOuts: { status: 'OBSERVED_REQUESTS_ONLY', requests: requests.slice(offset, offset + limit), total: requests.length,
        nextOffset: offset + limit < requests.length ? offset + limit : null, parentPayoutStatus: 'UNKNOWN',
        reason: 'A canonical public peg-out request does not prove a federation-authorized Bitcoin payout; no payout authority is configured.' } };
  }
  /** @asyncUnsafe */
  public async $getFederation(signal: AbortSignal = AbortSignal.timeout(15000)): Promise<LiquidFederationEpoch> {
    const snapshot = await this.engine().snapshot(signal), observation = snapshot.observation;
    const epoch = Math.floor(observation.elements.height / observation.elements.epochLength), start = epoch * observation.elements.epochLength;
    const changes = snapshot.state.blocks.filter(block => block.parameterType === 'full' && block.parameterRoot !== null);
    return { coverage: this.coverage(snapshot), epochNumber: epoch, signblockscript: observation.federation.signblockScript,
      fedpegScript: observation.federation.fedpegScript, fedpegProgram: observation.federation.fedpegProgram,
      parametersRoot: observation.elements.parametersRoot, activeSigners: null, totalSigners: null, threshold: null,
      startHeight: start, endHeight: start + observation.elements.epochLength - 1, blockSignerCounts: null,
      observedFullParameterRecordsTotal: changes.length, parameterHistoryLimit: 100,
      observedFullParameterRecords: changes.slice(-100).map(block => ({ height: block.height, blockHash: block.hash,
        parametersRoot: block.parameterRoot!, signblockScript: block.signblockScript })) };
  }
}
export const liquidObservatoryService = new LiquidObservatoryService();
