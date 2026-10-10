import { randomUUID, createHash } from 'crypto';
import { Transaction } from 'bitcoinjs-lib';
import { GlobalTransactionProof, ReconstructionV4Source } from './utxo-reconstruction-v4.source';
import { IrrelevantGlobalTransition } from './utxo-reconstruction-v4.types';
import { IEsploraApi } from './esplora-api.interface';
import { addressHistoryProblems, addressSummaryProblems, utxoListProblems } from './esplora-contract';
import { UtxoReconstructionV4View, ReconstructionV4Binding, UtxoReconstructionV4Inspection } from './utxo-reconstruction-v4.types';

import { ReconstructionError, ReconstructionOutput, ReconstructionSnapshot, ReconstructionSource } from './utxo-reconstruction.service';
import { AnchoredReconstructionSnapshot, ConfirmedReconstructionSnapshot, GlobalReconstructionSnapshot, ReconstructionAcquisitionError } from './utxo-reconstruction.source';
import { AddressSourceCheckpoint } from './address-source-checkpoint';
class ConfirmedAnchorChanged extends ReconstructionError {
  constructor() { super(409, 'Immutable confirmed anchor or source identity changed'); }
}
class MempoolAnchorChanged extends ReconstructionError {
  constructor(public reason = 'MEMPOOL_CHANGED') { super(409, reason); }
}
class ConfirmedTailChanged extends ReconstructionError {
  constructor() { super(409, 'CONFIRMED_TAIL_CHANGED'); }
}
const PAGE = 100, MEMPOOL_PAGE = 500, OUTPUT_PAGE = 100, MAX_TRANSACTIONS = 100000, MAX_OUTPUTS = 100000, MAX_TAIL_RESETS = 16;
// Fixed V4 lifetime covers bounded cold history paging plus manual continuation;
// it never slides and does not raise the retained memory or session limits.
const MAX_BYTES = 32 * 1024 * 1024, MAX_SESSIONS = 8, TTL = 60 * 60 * 1000;
const MAX_MONEY = 2100000000000000n;
type Stats = { transactions: number; funded: number; spent: number; fundedSum: bigint; spentSum: bigint };
type CachedGlobalProof = { txid: string; rawBytes: Buffer; rawSha256: string };
const emptyStats = (): Stats => ({ transactions: 0, funded: 0, spent: 0, fundedSum: 0n, spentSum: 0n });
interface GlobalState {
  proofs: Map<string, CachedGlobalProof>; bytes: number;
  mode: 'uninitialized' | 'strict-global-fallback' | 'irrelevant-delta-proof'; fallbackReason: string | null;
  initialIdentity: string | null; transitionCount: number; transitions: IrrelevantGlobalTransition[]; verifiedIdentity?: string;
}
const emptyGlobal = (transitionCount = 0): GlobalState => ({ proofs: new Map(), bytes: 0, mode: 'uninitialized', fallbackReason: null, initialIdentity: null, transitionCount, transitions: [] });
const MAX_GLOBAL_TRANSACTIONS = 100, MAX_GLOBAL_BYTES = 524288, MAX_GLOBAL_TRANSITIONS = 128;
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Session {
  id: string; address: string; snapshot: ConfirmedReconstructionSnapshot; mempoolAnchor?: GlobalReconstructionSnapshot; mempoolObservedAt?: string; mempoolEpoch: number; expires: number; cursor: number;
  latestObservedTip: AddressSourceCheckpoint;
  phase: 'confirmed' | 'reconcile-confirmed' | 'acquire-mempool' | 'mempool' | 'outspends' | 'complete';
  baseHead?: string; tailAnchor?: ConfirmedReconstructionSnapshot; tailClosed: boolean; confirmedEpoch: number;
  tail: Stats; tailTxids: Set<string>; tailSpent: Set<string>; tailOutputs: Set<string>; tailBytes: number;
  tailLastTx?: string; tailLastHeight?: number;
  scanLastHeight?: number; tailScanLastHeight?: number;
  prefixRowsObserved: number;
  status: UtxoReconstructionV4View['status']; reason?: string; lastTx?: string;
  lastHeight?: number;
  confirmed: Stats; mempool: Stats; mempoolTxids: Set<string>; mempoolSpent: Set<string>; mempoolOutputs: Set<string>; mempoolBytes: number; txids: Set<string>; spent: Set<string>;
  outputs: Map<string, ReconstructionOutput>; candidates: ReconstructionOutput[];
  verified: number; bytes: number; busy: boolean; controller?: AbortController;
  binding?: ReconstructionV4Binding; lastSuccessfulObservation?: UtxoReconstructionV4Inspection['lastSuccessfulObservation'];
  lastOperationError?: UtxoReconstructionV4Inspection['lastOperationError'];
  lastInput?: number; lastResponse?: UtxoReconstructionV4View;
  global: GlobalState; pendingGlobal?: { state: GlobalState; anchor: GlobalReconstructionSnapshot };
}
const point = (txid: string, vout: number): string => `${txid}:${vout}`;
const exactStats = (s: IEsploraApi.ChainStats): IEsploraApi.ChainStats => ({
  funded_txo_count: s.funded_txo_count, funded_txo_sum: s.funded_txo_sum,
  spent_txo_count: s.spent_txo_count, spent_txo_sum: s.spent_txo_sum, tx_count: s.tx_count,
});
const exactSummary = (s: IEsploraApi.Address): IEsploraApi.Address => ({
  address: s.address, chain_stats: exactStats(s.chain_stats), mempool_stats: exactStats(s.mempool_stats),
});
const identity = (s: ReconstructionSnapshot | ConfirmedReconstructionSnapshot): string => JSON.stringify({
  sourceId: s.sourceId, scriptPubKey: s.scriptPubKey,
  checkpoint: [s.checkpoint.genesisHash, s.checkpoint.network, s.checkpoint.signetChallenge],
});
const validAmount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && BigInt(v as number) <= MAX_MONEY;
const requireActive = (signal: AbortSignal): void => { if (signal.aborted) throw new ReconstructionError(499, 'Reconstruction request cancelled or exceeded its deadline'); };

/** Bounded, explicit history reconstruction. Full transactions are never retained. */
export class UtxoReconstructionV4Service {
  private sessions = new Map<string, Session>();
  private pendingCreates = 0;
  constructor(private source: ReconstructionV4Source, private network: string, private now: () => number = (): number => Date.now(), private binding?: () => ReconstructionV4Binding | undefined) {}

  private prune(): void {
    for (const session of this.sessions.values()) if (session.expires <= this.now()) {
      session.controller?.abort(); this.sessions.delete(session.id);
    }
  }
  private checkSnapshot(snapshot: ReconstructionSnapshot | ConfirmedReconstructionSnapshot, address: string): void {
    if (addressSummaryProblems(snapshot.summary, address).length || snapshot.checkpoint.network !== this.network ||
      !/^[0-9a-f]{64}$/.test(snapshot.checkpoint.genesisHash) || !/^[0-9a-f]{64}$/.test(snapshot.checkpoint.blockHash) ||
      !Number.isSafeInteger(snapshot.checkpoint.blockHeight) || snapshot.checkpoint.blockHeight < 0 ||
      !snapshot.sourceId || snapshot.mempoolIdentity !== null && !/^[0-9a-f]{64}$/.test(snapshot.mempoolIdentity) || typeof snapshot.scriptPubKey !== 'string' ||
      snapshot.scriptPubKey.length > 20000 || !/^(?:[0-9a-f]{2})+$/.test(snapshot.scriptPubKey)) throw new ReconstructionError(503, 'Invalid reconstruction source contract');
  }
  /** @asyncUnsafe */
  async create(address: string, signal: AbortSignal): Promise<UtxoReconstructionV4View> {
    this.prune();
    // Terminal receipts are a bounded cache, not eight permanent active slots.
    for (const session of this.sessions.values()) {
      if (this.sessions.size + this.pendingCreates < MAX_SESSIONS) break;
      if (!session.busy && !['PARTIAL', 'BLOCKED'].includes(session.status)) this.sessions.delete(session.id);
    }
    if (this.sessions.size + this.pendingCreates >= MAX_SESSIONS) throw new ReconstructionError(429, 'Reconstruction session capacity reached');
    requireActive(signal);
    this.pendingCreates++;
    try {
      const binding = this.binding?.();
      if (binding) {this.checkBinding(binding);}
      const snapshot = await this.source.confirmedSnapshot(address, signal);
      requireActive(signal); this.checkSnapshot(snapshot, address);
      const after = await this.source.confirmedSnapshot(address, signal, snapshot.checkpoint);
      requireActive(signal); this.checkSnapshot(after, address);
      if (identity(snapshot) !== identity(after) || snapshot.checkpoint.blockHeight !== after.checkpoint.blockHeight ||
          snapshot.checkpoint.blockHash !== after.checkpoint.blockHash ||
          JSON.stringify(exactStats(snapshot.summary.chain_stats)) !== JSON.stringify(exactStats(after.summary.chain_stats))) {
        throw new ReconstructionError(409, 'Initial confirmed anchor did not remain stable before and after acquisition');
      }
      // Retain only the specified fixed-size summary, never arbitrary upstream fields.
      snapshot.summary = exactSummary(snapshot.summary);
      if (snapshot.summary.chain_stats.tx_count > MAX_TRANSACTIONS || snapshot.summary.chain_stats.funded_txo_count > MAX_OUTPUTS) throw new ReconstructionError(422, 'Address exceeds bounded reconstruction capacity');
      const session: Session = { id: randomUUID(), address, snapshot, binding: binding ? { ...binding } : undefined, latestObservedTip: { ...snapshot.checkpoint }, expires: this.now() + TTL, cursor: 0,
        phase: 'confirmed', status: 'PARTIAL', confirmed: emptyStats(), mempool: emptyStats(), mempoolEpoch: 0,
        tail: emptyStats(), tailTxids: new Set(), tailSpent: new Set(), tailOutputs: new Set(), tailBytes: 0,
        tailClosed: false, confirmedEpoch: 0,
        prefixRowsObserved: 0,
        mempoolTxids: new Set(), mempoolSpent: new Set(), mempoolOutputs: new Set(), mempoolBytes: 0,
        txids: new Set(), spent: new Set(), outputs: new Map(), candidates: [], verified: 0, bytes: 0, busy: false, global: emptyGlobal() };
      this.sessions.set(session.id, session); return this.recordResponse(session);
    } finally { this.pendingCreates--; }
  }
  private find(address: string, id: string): Session {
    this.prune(); const session = this.sessions.get(id);
    if (!session || session.address !== address || session.snapshot.checkpoint.network !== this.network) throw new ReconstructionError(404, 'Reconstruction session not found in this address context');
    return session;
  }
  private checkBinding(binding: ReconstructionV4Binding): void {
    if (
      Object.keys(binding).sort().join(',') !== 'configurationSha256,network,releaseSha' ||
      binding.network !== this.network ||
      !/^[0-9a-f]{40}$/.test(binding.releaseSha) ||
      !/^[0-9a-f]{64}$/.test(binding.configurationSha256)
    ) {
      throw new ReconstructionError(503, 'Reconstruction artifact binding unavailable');
    }
  }
  private recordResponse(session: Session): UtxoReconstructionV4View {
    const response = this.view(session);
    session.lastSuccessfulObservation = {
      cursor: response.cursor,
      observedAt: response.observedAt,
      checkpoint: {
        network: response.latestObservedTip.network,
        genesisHash: response.latestObservedTip.genesisHash,
        blockHeight: response.latestObservedTip.blockHeight,
        blockHash: response.latestObservedTip.blockHash,
        verifiedAt: response.latestObservedTip.verifiedAt,
        signetChallenge: response.latestObservedTip.signetChallenge,
      },
      progress: { ...response.progress },
    };
    session.lastOperationError = null;
    return response;
  }
  inspect(address: string, id: string, expected: ReconstructionV4Binding): UtxoReconstructionV4Inspection {
    const session = this.find(address, id);
    const current = this.binding?.(),
      originalBinding = session.binding;
    if (!current || !originalBinding || !session.lastSuccessfulObservation) {
      throw new ReconstructionError(503, 'Reconstruction artifact binding unavailable');
    }
    this.checkBinding(current);
    if (
      typeof session.lastSuccessfulObservation.checkpoint.signetChallenge === 'string' &&
      session.lastSuccessfulObservation.checkpoint.signetChallenge.length > 10000
    ) {
      throw new ReconstructionError(422, 'Reconstruction inspection checkpoint exceeds capacity');
    }
    if (
      expected.network !== this.network ||
      ['network', 'releaseSha', 'configurationSha256'].some(
        (key) => expected[key] !== current[key] || originalBinding[key] !== current[key],
      )
    ) {
      throw new ReconstructionError(409, 'Reconstruction session artifact or source profile changed');
    }
    // Fixed-size copies only: no view/result construction, source acquisition, TTL refresh or slot admission.
    return {
      schema: 'universe-address-utxo-reconstruction-inspection-v1',
      sessionId: session.id,
      address: session.address,
      network: this.network,
      status: session.status,
      busy: session.busy,
      cursor: session.cursor,
      replayCursor: session.lastResponse ? (session.lastInput ?? null) : null,
      expiresAt: new Date(session.expires).toISOString(),
      binding: {
        ...current,
        sourceId: session.snapshot.sourceId,
        confirmedAnchorSha256: digest({
          ...session.snapshot.checkpoint,
          sourceId: session.snapshot.sourceId,
          scriptPubKey: session.snapshot.scriptPubKey,
          chainStats: exactStats(session.snapshot.summary.chain_stats),
        }),
      },
      retainedBytes: session.bytes,
      resultAvailable: session.status === 'COMPLETE_AT_OBSERVED_TIP',
      lastSuccessfulObservation: {
        ...session.lastSuccessfulObservation,
        checkpoint: { ...session.lastSuccessfulObservation.checkpoint },
        progress: { ...session.lastSuccessfulObservation.progress },
      },
      lastOperationError: session.lastOperationError ? { ...session.lastOperationError } : null,
    };
  }
  cancel(address: string, id: string): UtxoReconstructionV4View {
    const session = this.find(address, id); session.controller?.abort();
    session.status = 'CANCELLED'; session.reason = 'Explicitly cancelled'; this.release(session); return this.view(session);
  }
  private release(session: Session): void { session.outputs.clear(); session.txids.clear(); session.spent.clear(); session.candidates = []; session.bytes = 0; session.lastResponse = undefined; session.mempoolTxids.clear(); session.mempoolSpent.clear(); session.mempoolOutputs.clear(); session.mempoolBytes = 0; session.tailTxids.clear(); session.tailSpent.clear(); session.tailOutputs.clear(); session.tailBytes = 0; session.pendingGlobal = undefined; session.global = emptyGlobal(session.global.transitionCount); }
  private cancelled(session: Session): boolean { return session.status === 'CANCELLED'; }
  private activeSession(session: Session, signal: AbortSignal): void {
    requireActive(signal);
    if (session.expires <= this.now()) { this.release(session); this.sessions.delete(session.id); throw new ReconstructionError(404, 'Reconstruction session expired'); }
  }
  private matches(session: Session, snapshot: AnchoredReconstructionSnapshot | ConfirmedReconstructionSnapshot): void {
    this.checkSnapshot(snapshot, session.address);
    if (identity(snapshot) !== identity(session.snapshot)) throw new ConfirmedAnchorChanged();
    const original = session.snapshot.checkpoint, latest = snapshot.checkpoint;
    if (latest.blockHeight < original.blockHeight ||
      latest.blockHeight === original.blockHeight && latest.blockHash !== original.blockHash ||
      latest.blockHeight !== original.blockHeight && (snapshot.canonicalAnchor?.heightAtomic !== String(original.blockHeight) || snapshot.canonicalAnchor?.blockHash !== original.blockHash)) throw new ConfirmedAnchorChanged();
    session.latestObservedTip = { ...latest };
  }
  private matchesTail(session: Session, snapshot: AnchoredReconstructionSnapshot | ConfirmedReconstructionSnapshot): void {
    this.matches(session, snapshot);
    if (!session.tailAnchor || snapshot.checkpoint.blockHeight !== session.tailAnchor.checkpoint.blockHeight ||
        snapshot.checkpoint.blockHash !== session.tailAnchor.checkpoint.blockHash ||
        JSON.stringify(exactStats(snapshot.summary.chain_stats)) !== JSON.stringify(exactStats(session.tailAnchor.summary.chain_stats))) throw new ConfirmedTailChanged();
  }
  private checkGlobal(snapshot: GlobalReconstructionSnapshot): void {
    const global = snapshot.globalMempool;
    if (typeof snapshot.mempoolIdentity !== 'string' || !/^[0-9a-f]{64}$/.test(snapshot.mempoolIdentity) ||
        !global || !Number.isSafeInteger(global.transactionCount) || global.transactionCount < 0 || global.transactionCount > 50000 ||
        !/^(0|[1-9][0-9]{0,15})$/.test(global.sequenceAtomic) || !Number.isSafeInteger(Number(global.sequenceAtomic)) ||
        (global.txids === null ? global.transactionCount <= MAX_GLOBAL_TRANSACTIONS : !Array.isArray(global.txids) || global.txids.length !== global.transactionCount ||
          global.txids.length > MAX_GLOBAL_TRANSACTIONS || global.txids.some((txid, index) => !/^[0-9a-f]{64}$/.test(txid) || index > 0 && txid <= global.txids![index - 1]))) {
      throw new ReconstructionError(503, 'Invalid independently fenced global mempool proof context');
    }
    if (global.txids && snapshot.mempoolIdentity !== digest({ ids: global.txids, sequence: Number(global.sequenceAtomic) })) throw new ReconstructionError(503, 'Global mempool identifiers do not bind their observed identity');
  }
  private proofBytes(state: GlobalState): number {
    return 512 + [...state.proofs.values()].reduce((sum, proof) => sum + 1024 + proof.rawBytes.length * 4, 0) +
      state.transitions.reduce((sum, transition) => sum + 256 + Buffer.byteLength(JSON.stringify(transition)) * 4, 0);
  }
  private proofRelevant(session: Session, proof: CachedGlobalProof, globalFunding = new Set<string>()): boolean {
    if (!proof || !/^[0-9a-f]{64}$/.test(proof.txid) || !Buffer.isBuffer(proof.rawBytes) || !proof.rawBytes.length || proof.rawBytes.length > 524288 ||
        proof.rawBytes.byteOffset !== 0 || proof.rawBytes.buffer.byteLength !== proof.rawBytes.length ||
        createHash('sha256').update(proof.rawBytes).digest('hex') !== proof.rawSha256) throw new MempoolAnchorChanged('GLOBAL_TRANSACTION_PROOF_UNKNOWN');
    let transaction: Transaction;
    try { transaction = Transaction.fromBuffer(proof.rawBytes); } catch { throw new MempoolAnchorChanged('GLOBAL_TRANSACTION_PROOF_UNKNOWN'); }
    if (transaction.getId() !== proof.txid) throw new MempoolAnchorChanged('GLOBAL_TRANSACTION_PROOF_UNKNOWN');
    return transaction.outs.some(output => Buffer.from(output.script).toString('hex') === session.snapshot.scriptPubKey) ||
      transaction.ins.some(input => { const key = point(Buffer.from(input.hash).reverse().toString('hex'), input.index); return session.outputs.has(key) || globalFunding.has(key); });
  }
  /** Fold bounded native waves into exact-size unpooled bytes; never accumulate baseline hex strings. @asyncUnsafe */
  private async acquireGlobal(session: Session, ids: string[], signal: AbortSignal): Promise<Map<string, CachedGlobalProof>> {
    const proofs = new Map<string, CachedGlobalProof>(); let bytes = 512;
    const consume = (proof: GlobalTransactionProof): void => {
      requireActive(signal);
      if (!proof || !ids.includes(proof.txid) || proofs.has(proof.txid) || typeof proof.rawHex !== 'string' ||
          proof.rawHex.length > 1048576 || !/^(?:[0-9a-f]{2})+$/.test(proof.rawHex)) throw new MempoolAnchorChanged('GLOBAL_TRANSACTION_PROOF_UNKNOWN');
      const length = proof.rawHex.length / 2, charged = 1024 + length * 4;
      if (bytes + charged > MAX_GLOBAL_BYTES) throw new MempoolAnchorChanged('GLOBAL_PROOF_BYTE_CAPACITY');
      const rawBytes = Buffer.allocUnsafeSlow(length); rawBytes.write(proof.rawHex, 'hex');
      const cached = { txid: proof.txid, rawSha256: proof.rawSha256, rawBytes };
      this.proofRelevant(session, cached); proofs.set(proof.txid, cached); bytes += charged;
    };
    const returned = await this.source.globalTransactions(ids, signal, consume);
    requireActive(signal);
    for (const proof of returned) consume(proof);
    if (proofs.size !== ids.length) throw new MempoolAnchorChanged('GLOBAL_TRANSACTION_PROOF_UNKNOWN');
    return proofs;
  }
  private globalFunding(session: Session, proofs: Map<string, CachedGlobalProof>): Set<string> {
    const result = new Set<string>();
    for (const proof of proofs.values()) {
      this.proofRelevant(session, proof);
      const transaction = Transaction.fromBuffer(proof.rawBytes);
      transaction.outs.forEach((output, index) => { if (Buffer.from(output.script).toString('hex') === session.snapshot.scriptPubKey) result.add(point(proof.txid, index)); });
    }
    return result;
  }
  private assertGlobalAddressClosure(session: Session): void {
    const state = session.pendingGlobal?.state || session.global;
    if (state.mode !== 'irrelevant-delta-proof') return;
    const funding = this.globalFunding(session, state.proofs);
    const relevant = [...state.proofs.values()].filter(proof => this.proofRelevant(session, proof, funding)).map(proof => proof.txid).sort();
    if (JSON.stringify(relevant) !== JSON.stringify([...session.mempoolTxids].sort())) throw new ReconstructionError(422, 'Independent native global transactions do not close against address mempool history');
  }
  private sameGlobal(session: Session, expected: GlobalReconstructionSnapshot, actual: GlobalReconstructionSnapshot): void {
    this.matchesTail(session, actual); this.checkGlobal(actual);
    if (actual.mempoolIdentity !== expected.mempoolIdentity || JSON.stringify(exactStats(actual.summary.mempool_stats)) !== JSON.stringify(exactStats(expected.summary.mempool_stats))) throw new MempoolAnchorChanged();
  }
  /** @asyncUnsafe */
  private async initialGlobal(session: Session, anchor: GlobalReconstructionSnapshot, signal: AbortSignal): Promise<{ state: GlobalState; anchor: GlobalReconstructionSnapshot }> {
    this.checkGlobal(anchor);
    const state = emptyGlobal(session.global.transitionCount); state.initialIdentity = anchor.mempoolIdentity;
    state.mode = 'strict-global-fallback'; state.fallbackReason = anchor.globalMempool.txids === null ? 'GLOBAL_POOL_EXCEEDS_PROOF_CAPACITY' : 'GLOBAL_BASELINE_PROOF_UNAVAILABLE';
    if (anchor.globalMempool.txids) {
      try {
        state.proofs = await this.acquireGlobal(session, anchor.globalMempool.txids, signal); requireActive(signal);
        state.bytes = this.proofBytes(state);
        if (state.bytes <= MAX_GLOBAL_BYTES && session.bytes + state.bytes <= MAX_BYTES) { state.mode = 'irrelevant-delta-proof'; state.fallbackReason = null; }
        else { state.proofs.clear(); state.bytes = 512; state.fallbackReason = 'GLOBAL_PROOF_BYTE_CAPACITY'; }
      } catch (error) { requireActive(signal); state.proofs.clear(); state.bytes = 512; if (error instanceof MempoolAnchorChanged && error.reason === 'GLOBAL_PROOF_BYTE_CAPACITY') state.fallbackReason = error.reason; }
    } else state.bytes = 512;
    const after = await this.source.snapshot(session.address, signal, session.snapshot.checkpoint);
    this.sameGlobal(session, anchor, after); requireActive(signal);
    if (session.bytes + state.bytes > MAX_BYTES) throw new ReconstructionError(422, 'Reconstruction retained memory capacity exceeded');
    return { state, anchor: after };
  }
  private commitGlobal(session: Session): void {
    const pending = session.pendingGlobal;
    if (!pending) return;
    if (session.bytes - session.global.bytes + pending.state.bytes > MAX_BYTES) throw new ReconstructionError(422, 'Reconstruction retained memory capacity exceeded');
    if (session.mempoolAnchor && session.mempoolAnchor.mempoolIdentity !== pending.anchor.mempoolIdentity) {
      const observed = pending.state.transitions[pending.state.transitions.length - 1];
      if (!observed || observed.toIdentity !== pending.anchor.mempoolIdentity) throw new MempoolAnchorChanged('GLOBAL_TRANSACTION_PROOF_UNKNOWN');
      session.mempoolObservedAt = observed.observedAt;
    }
    session.bytes += pending.state.bytes - session.global.bytes;
    session.global = pending.state; session.mempoolAnchor = pending.anchor;
    session.pendingGlobal = undefined;
  }
  /** Preserve proofs only after independent transaction bytes prove every changed global entry irrelevant. @asyncUnsafe */
  private async matchesMempool(session: Session, snapshot: GlobalReconstructionSnapshot, signal: AbortSignal): Promise<void> {
    this.matchesTail(session, snapshot);
    this.checkGlobal(snapshot);
    const old = session.pendingGlobal?.anchor || session.mempoolAnchor, previous = session.pendingGlobal?.state || session.global;
    if (old && (snapshot.checkpoint.blockHeight !== old.checkpoint.blockHeight || snapshot.checkpoint.blockHash !== old.checkpoint.blockHash)) throw new MempoolAnchorChanged('FINAL_TIP_CHANGED');
    if (!old || JSON.stringify(exactStats(snapshot.summary.mempool_stats)) !== JSON.stringify(exactStats(old.summary.mempool_stats))) throw new MempoolAnchorChanged();
    if ((session.verified > 0 || session.phase === 'complete') && previous.verifiedIdentity !== old.mempoolIdentity) throw new MempoolAnchorChanged('VERIFIED_OUTPUT_CONTEXT_UNKNOWN');
    if (snapshot.mempoolIdentity === old.mempoolIdentity) return;
    if (previous.mode !== 'irrelevant-delta-proof' || !old.globalMempool.txids || !snapshot.globalMempool.txids) throw new MempoolAnchorChanged('STRICT_GLOBAL_MEMPOOL_CHANGED');
    if (previous.transitionCount >= MAX_GLOBAL_TRANSITIONS) throw new ReconstructionError(422, 'Global mempool proof transition capacity exceeded');
    const added = snapshot.globalMempool.txids.filter(txid => !old.globalMempool.txids!.includes(txid));
    const removed = old.globalMempool.txids.filter(txid => !snapshot.globalMempool.txids!.includes(txid));
    if (!added.length && !removed.length || added.length + removed.length > MAX_GLOBAL_TRANSACTIONS) throw new MempoolAnchorChanged('GLOBAL_TRANSACTION_PROOF_UNKNOWN');
    const missingRemoved = removed.filter(txid => !previous.proofs.has(txid));
    let acquired: Map<string, CachedGlobalProof>;
    try { acquired = await this.acquireGlobal(session, [...added, ...missingRemoved], signal); }
    catch (error) { requireActive(signal); if (error instanceof MempoolAnchorChanged && error.reason === 'GLOBAL_PROOF_BYTE_CAPACITY') throw error; throw new MempoolAnchorChanged('GLOBAL_TRANSACTION_PROOF_UNAVAILABLE'); }
    requireActive(signal);
    const expected = [...added, ...missingRemoved];
    if (acquired.size !== expected.length || [...acquired.keys()].some(txid => !expected.includes(txid))) throw new MempoolAnchorChanged('GLOBAL_TRANSACTION_PROOF_UNKNOWN');
    const byId = acquired;
    const changed = [...added, ...removed].map(txid => byId.get(txid) || previous.proofs.get(txid));
    const combined = new Map([...previous.proofs, ...byId]);
    const globalFunding = this.globalFunding(session, combined);
    if (changed.some(proof => !proof || this.proofRelevant(session, proof, globalFunding))) throw new MempoolAnchorChanged('ADDRESS_RELEVANT_GLOBAL_TRANSACTION');
    const proofs = new Map(previous.proofs); removed.forEach(txid => proofs.delete(txid)); [...acquired.values()].filter(proof => added.includes(proof.txid)).forEach(proof => proofs.set(proof.txid, proof));
    if (proofs.size !== snapshot.globalMempool.transactionCount || snapshot.globalMempool.txids.some(txid => !proofs.has(txid))) throw new MempoolAnchorChanged('GLOBAL_TRANSACTION_PROOF_UNKNOWN');
    const after = await this.source.snapshot(session.address, signal, session.snapshot.checkpoint);
    this.sameGlobal(session, snapshot, after); requireActive(signal);
    const transition: IrrelevantGlobalTransition = { transition: previous.transitionCount + 1, fromIdentity: old.mempoolIdentity, toIdentity: after.mempoolIdentity,
      addedTxids: added, removedTxids: removed, observedAt: new Date(this.now()).toISOString(), verifiedOutputsRetained: session.verified,
      proofSha256: digest({ source: identity(session.snapshot), script: session.snapshot.scriptPubKey,
        fundingOutpoints: [...session.outputs.keys()].sort(), candidates: session.candidates.map(output => point(output.txid, output.vout)).sort(),
        globalFundingOutpoints: [...globalFunding].sort(),
        verifiedOutpoints: session.candidates.slice(0, session.verified).map(output => point(output.txid, output.vout)),
        from: old.globalMempool, to: after.globalMempool, transactions: changed.map(proof => ({ txid: proof!.txid, rawSha256: proof!.rawSha256, relevant: false })) }) };
    const state: GlobalState = { ...previous, proofs, transitionCount: transition.transition, transitions: [...previous.transitions, transition].slice(-8), verifiedIdentity: session.verified > 0 || session.phase === 'complete' ? after.mempoolIdentity : undefined };
    state.bytes = this.proofBytes(state);
    if (state.bytes > MAX_GLOBAL_BYTES || session.bytes - session.global.bytes + state.bytes > MAX_BYTES) throw new MempoolAnchorChanged('GLOBAL_PROOF_BYTE_CAPACITY');
    session.pendingGlobal = { state, anchor: after };
  }
  private resetMempool(session: Session, reason = 'MEMPOOL_CHANGED'): void {
    session.bytes -= session.global.bytes; session.pendingGlobal = undefined; session.global = emptyGlobal(session.global.transitionCount);
    for (const txid of session.mempoolTxids) session.txids.delete(txid);
    for (const key of session.mempoolSpent) session.spent.delete(key);
    for (const key of session.mempoolOutputs) session.outputs.delete(key);
    session.bytes -= session.mempoolBytes;
    session.mempoolTxids.clear(); session.mempoolSpent.clear(); session.mempoolOutputs.clear(); session.mempoolBytes = 0;
    session.mempool = emptyStats(); session.mempoolAnchor = undefined; session.mempoolObservedAt = undefined;
    session.candidates = []; session.verified = 0; session.phase = 'acquire-mempool';
    session.status = 'PARTIAL'; session.reason = reason; session.mempoolEpoch++;
    session.lastResponse = undefined;
  }
  private resetTail(session: Session): void {
    if (session.confirmedEpoch >= MAX_TAIL_RESETS) {
      session.status = 'INVALIDATED'; session.reason = 'Confirmed tail exceeded its bounded reset capacity'; this.release(session);
      throw new ReconstructionError(422, session.reason);
    }
    this.resetMempool(session, 'CONFIRMED_TAIL_CHANGED');
    for (const txid of session.tailTxids) session.txids.delete(txid);
    for (const key of session.tailSpent) session.spent.delete(key);
    for (const key of session.tailOutputs) session.outputs.delete(key);
    session.bytes -= session.tailBytes;
    session.tailTxids.clear(); session.tailSpent.clear(); session.tailOutputs.clear(); session.tailBytes = 0;
    session.tail = emptyStats(); session.tailAnchor = undefined; session.tailClosed = false;
    session.tailLastTx = undefined; session.tailLastHeight = undefined; session.tailScanLastHeight = undefined;
    session.phase = 'reconcile-confirmed'; session.confirmedEpoch++;
  }
  async next(address: string, id: string, cursor: number, signal: AbortSignal): Promise<UtxoReconstructionV4View> {
    const session = this.find(address, id);
    if (session.binding) {
      const originalBinding = session.binding, current = this.binding?.();
      if (!current) {throw new ReconstructionError(503, 'Reconstruction artifact binding unavailable');}
      this.checkBinding(current);
      if (['network','releaseSha','configurationSha256'].some(key => originalBinding[key] !== current[key])) {throw new ReconstructionError(409, 'Reconstruction session artifact or source profile changed');}
    }
    requireActive(signal);
    if (session.busy) throw new ReconstructionError(409, 'A reconstruction page is already in progress');
    if (session.status === 'CANCELLED' || session.status === 'INVALIDATED') return this.view(session);
    const replay = cursor === session.lastInput && !!session.lastResponse;
    if (!Number.isSafeInteger(cursor) || !replay && cursor !== session.cursor) throw new ReconstructionError(409, 'Reconstruction cursor is stale');
    const controller = new AbortController(), abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    session.busy = true; session.controller = controller;
    try {
      requireActive(controller.signal);
      const before = await this.source.confirmedSnapshot(address, controller.signal, session.snapshot.checkpoint);
      this.matches(session, before);
      requireActive(controller.signal);
      if (session.tailAnchor) this.matchesTail(session, before);
      if (session.mempoolAnchor) await this.matchesMempool(session, await this.source.snapshot(address, controller.signal, session.snapshot.checkpoint), controller.signal);
      if (replay || session.status === 'COMPLETE_AT_OBSERVED_TIP') {
        this.activeSession(session, controller.signal);
        this.commitGlobal(session);
        if (session.verified > 0) session.global.verifiedIdentity = session.mempoolAnchor!.mempoolIdentity;
        session.lastResponse = this.recordResponse(session); return session.lastResponse;
      }
      if (session.phase === 'acquire-mempool') {
        const anchor = await this.source.snapshot(address, controller.signal, session.snapshot.checkpoint);
        this.matchesTail(session, anchor); requireActive(controller.signal);
        this.activeSession(session, controller.signal);
        if (anchor.summary.mempool_stats.tx_count > MEMPOOL_PAGE ||
          session.confirmed.transactions + session.tail.transactions + anchor.summary.mempool_stats.tx_count > MAX_TRANSACTIONS ||
          session.confirmed.funded + session.tail.funded + anchor.summary.mempool_stats.funded_txo_count > MAX_OUTPUTS) throw new ReconstructionError(422, 'Address mempool exceeds bounded reconstruction capacity');
        anchor.summary = exactSummary(anchor.summary);
        const global = await this.initialGlobal(session, anchor, controller.signal);
        this.activeSession(session, controller.signal);
        if (this.cancelled(session)) return this.view(session);
        session.pendingGlobal = global; this.commitGlobal(session); session.mempoolObservedAt = new Date(this.now()).toISOString();
        session.phase = 'mempool'; session.reason = undefined;
      } else if (session.phase === 'outspends') {
        const outputs = session.candidates.slice(session.verified, session.verified + OUTPUT_PAGE);
        await this.source.verifyOutputs(outputs, controller.signal, session.mempoolAnchor!.checkpoint);
        requireActive(controller.signal);
        const after = await this.source.snapshot(address, controller.signal, session.snapshot.checkpoint);
        await this.matchesMempool(session, after, controller.signal);
        requireActive(controller.signal);
        this.activeSession(session, controller.signal);
        if (this.cancelled(session)) return this.view(session);
        this.commitGlobal(session);
        session.verified += outputs.length;
        session.global.verifiedIdentity = session.mempoolAnchor!.mempoolIdentity;
        if (session.verified === session.candidates.length) { session.phase = 'complete'; session.status = 'COMPLETE_AT_OBSERVED_TIP'; }
      } else {
        const mempool = session.phase === 'mempool';
        const tail = session.phase === 'reconcile-confirmed';
        const work = tail && !session.tailAnchor ? { ...session, tailAnchor: { ...before, summary: exactSummary(before.summary) } } : session;
        if (tail && (work.tailAnchor!.summary.chain_stats.tx_count > MAX_TRANSACTIONS || work.tailAnchor!.summary.chain_stats.funded_txo_count > MAX_OUTPUTS)) throw new ReconstructionError(422, 'Confirmed tail exceeds bounded reconstruction capacity');
        const rows = mempool ? await this.source.mempool(address, MEMPOOL_PAGE, controller.signal)
          : await this.source.history(address, tail ? session.tailLastTx : session.lastTx, PAGE, controller.signal);
        requireActive(controller.signal);
        if (addressHistoryProblems(rows, mempool ? MEMPOOL_PAGE : PAGE).length) throw new ReconstructionError(422, 'Invalid bounded transaction page');
        if (!mempool) {
          if (!tail && session.prefixRowsObserved + rows.length > 2 * MAX_TRANSACTIONS) throw new ReconstructionError(422, 'Confirmed prefix observation capacity exceeded');
          let previousHeight = (tail ? session.tailScanLastHeight : session.scanLastHeight) ?? Number.POSITIVE_INFINITY;
          for (const row of rows) {
            if (row.status.block_height! > previousHeight || row.status.block_height! > before.checkpoint.blockHeight) throw new ReconstructionError(422, 'Confirmed raw page order or observed tip is invalid');
            previousHeight = row.status.block_height!;
          }
          await this.source.verifyHistoryBlocks(rows, controller.signal);
          requireActive(controller.signal);
          if (rows.length && rows[rows.length - 1].txid === (tail ? session.tailLastTx : session.lastTx)) throw new ReconstructionError(422, 'Confirmed history cursor made no progress');
        }
        const boundary = tail && session.baseHead ? rows.findIndex(row => row.txid === session.baseHead) : -1;
        if (tail && rows.some((row, index) => row.status.block_height! <= session.snapshot.checkpoint.blockHeight && (boundary < 0 || index < boundary))) throw new ReconstructionError(422, 'Confirmed tail did not reach the exact immutable prefix boundary');
        const boundaryReached = tail && (boundary >= 0 || !session.baseHead && !rows.length);
        if (tail && !rows.length && session.baseHead) throw new ReconstructionError(422, 'Confirmed tail ended before the immutable prefix boundary');
        const selected = mempool ? rows : tail ? boundary >= 0 ? rows.slice(0, boundary) : rows
          : rows.filter(row => row.status.block_height! <= session.snapshot.checkpoint.blockHeight);
        const delta = this.readPage(work, selected, mempool, tail);
        const after = mempool ? await this.source.snapshot(address, controller.signal, session.snapshot.checkpoint) : await this.source.confirmedSnapshot(address, controller.signal, session.snapshot.checkpoint);
        if (mempool) await this.matchesMempool(session, after as GlobalReconstructionSnapshot, controller.signal);
        else if (tail) this.matchesTail(work, after);
        else this.matches(session, after);
        requireActive(controller.signal);
        if (this.cancelled(session)) return this.view(session);
        this.activeSession(session, controller.signal);
        this.commitGlobal(session);
        const updated = { ...(mempool ? session.mempool : tail ? session.tail : session.confirmed) };
        for (const key of ['transactions', 'funded', 'spent'] as const) updated[key] += delta.stats[key];
        updated.fundedSum += delta.stats.fundedSum; updated.spentSum += delta.stats.spentSum;
        if (!mempool && !tail && !rows.length) this.assertStats(updated, session.snapshot.summary.chain_stats);
        if (boundaryReached) this.assertStats(this.addStats(session.confirmed, updated), work.tailAnchor!.summary.chain_stats);
        if (mempool) this.assertStats(updated, session.mempoolAnchor!.summary.mempool_stats);
        // Commit progress only after the bounded page and source checks succeed.
        for (const txid of delta.txids) session.txids.add(txid);
        for (const key of delta.spent) session.spent.add(key);
        for (const [key, output] of delta.outputs) session.outputs.set(key, output);
        const stats = mempool ? session.mempool : tail ? session.tail : session.confirmed;
        for (const key of ['transactions', 'funded', 'spent'] as const) stats[key] += delta.stats[key];
        stats.fundedSum += delta.stats.fundedSum; stats.spentSum += delta.stats.spentSum;
        session.bytes += delta.bytes;
        if (mempool) {
          session.mempoolBytes += delta.bytes;
          for (const txid of delta.txids) session.mempoolTxids.add(txid);
          for (const key of delta.spent) session.mempoolSpent.add(key);
          for (const key of delta.outputs.keys()) session.mempoolOutputs.add(key);
        }
        if (tail) {
          session.tailAnchor = work.tailAnchor; session.latestObservedTip = { ...work.latestObservedTip };
          session.tailBytes += delta.bytes;
          for (const txid of delta.txids) session.tailTxids.add(txid);
          for (const key of delta.spent) session.tailSpent.add(key);
          for (const key of delta.outputs.keys()) session.tailOutputs.add(key);
          if (rows.length) session.tailLastTx = rows[rows.length - 1].txid;
          if (rows.length) session.tailScanLastHeight = rows[rows.length - 1].status.block_height;
          if (selected.length) session.tailLastHeight = selected[selected.length - 1].status.block_height;
        } else if (!mempool) {
          session.prefixRowsObserved += rows.length;
          if (!session.baseHead && selected.length) session.baseHead = selected[0].txid;
          if (rows.length) session.lastTx = rows[rows.length - 1].txid;
          if (rows.length) session.scanLastHeight = rows[rows.length - 1].status.block_height;
          if (selected.length) session.lastHeight = selected[selected.length - 1].status.block_height;
        }
        if (mempool) { this.assertStats(stats, session.mempoolAnchor!.summary.mempool_stats); this.assertGlobalAddressClosure(session); this.finishHistory(session); }
        else if (tail && boundaryReached) { session.tailClosed = true; session.phase = 'acquire-mempool'; }
        else if (!tail && !rows.length) session.phase = 'reconcile-confirmed';
      }
      session.cursor++; session.lastInput = cursor; session.lastResponse = this.recordResponse(session); return session.lastResponse;
    } catch (caught) {
      session.pendingGlobal = undefined;
      let error = caught;
      const acquisition = error instanceof ReconstructionAcquisitionError ? error : undefined;
      session.lastOperationError = {cursor, status: controller.signal.aborted ? 499 : error instanceof ReconstructionError ? error.status : 503,
        code: controller.signal.aborted ? 'CANCELLED_OR_DEADLINE' : acquisition && ['DEADLINE','UPSTREAM_UNAVAILABLE'].includes(acquisition.causeCode) ? acquisition.causeCode : 'SOURCE_OR_CONTEXT_UNAVAILABLE',
        ...(acquisition && ['confirmed-history','address-mempool','index-mempool-identity','address-statistics','index-chain-checkpoint','index-outspends','core-output-verification','core-getblockchaininfo','core-getblockhash','core-getrawmempool','core-getmempoolinfo','core-getrawtransaction','core-validateaddress'].includes(acquisition.phase) ? {phase:acquisition.phase} : {}),failedAt:new Date(this.now()).toISOString()};
      if (this.cancelled(session)) return this.view(session);
      // Transport cancellation/deadline leaves the original cursor retryable.
      if (controller.signal.aborted) throw error;
      if (error instanceof ConfirmedTailChanged) {
        try {
          const confirmed = await this.source.confirmedSnapshot(address, controller.signal, session.snapshot.checkpoint);
          this.matches(session, confirmed); this.activeSession(session, controller.signal);
        } catch (failure) {
          if (!(failure instanceof ConfirmedAnchorChanged)) throw failure;
          session.status = 'INVALIDATED'; session.reason = failure.message; this.release(session); return this.view(session);
        }
        this.resetTail(session); session.cursor++; session.lastInput = cursor;
        session.lastResponse = this.recordResponse(session); return session.lastResponse;
      }
      if (error instanceof ReconstructionError && error.status === 409 && ['confirmed', 'reconcile-confirmed'].includes(session.phase) && [
        'Core and index must share the exact active tip for reconstruction',
        'Active chain moved during confirmed source acquisition',
        'Owned checkpoint moved during address source verification',
      ].includes(error.message)) throw new ReconstructionError(503, 'Shared tip moved during acquisition; original cursor remains retryable pending fresh canonical anchor proof');
      if (error instanceof ReconstructionError && error.status === 409 && !(error instanceof ConfirmedAnchorChanged) && session.tailClosed) {
        // Only retain confirmed progress after a separate fresh chain check.
        try {
          const confirmed = await this.source.confirmedSnapshot(address, controller.signal, session.snapshot.checkpoint);
          this.matches(session, confirmed); requireActive(controller.signal);
          try { this.matchesTail(session, confirmed); }
          catch (failure) {
            if (!(failure instanceof ConfirmedTailChanged)) throw failure;
            this.resetTail(session); session.cursor++; session.lastInput = cursor;
            session.lastResponse = this.recordResponse(session); return session.lastResponse;
          }
          if (error instanceof MempoolAnchorChanged || !session.mempoolAnchor) {
            this.resetMempool(session, error instanceof MempoolAnchorChanged ? error.reason : 'MEMPOOL_CHANGED');
          } else {
            // A genuine output mismatch with unchanged mempool remains invalid.
            let latest: ReconstructionSnapshot | undefined;
            try { latest = await this.source.snapshot(address, controller.signal, session.snapshot.checkpoint); }
            catch (failure) { if (!(failure instanceof ReconstructionError) || failure.status !== 409) throw failure; }
            if (latest) {
              this.matches(session, latest);
              if (latest.checkpoint.blockHeight === session.mempoolAnchor.checkpoint.blockHeight &&
                latest.checkpoint.blockHash === session.mempoolAnchor.checkpoint.blockHash &&
                latest.mempoolIdentity === session.mempoolAnchor.mempoolIdentity &&
                JSON.stringify(exactStats(latest.summary.mempool_stats)) === JSON.stringify(exactStats(session.mempoolAnchor.summary.mempool_stats))) throw error;
            }
            this.resetMempool(session, latest && (latest.checkpoint.blockHeight !== session.mempoolAnchor!.checkpoint.blockHeight ||
              latest.checkpoint.blockHash !== session.mempoolAnchor!.checkpoint.blockHash) ? 'FINAL_TIP_CHANGED' : 'MEMPOOL_CHANGED');
          }
          session.cursor++; session.lastInput = cursor; session.lastResponse = this.recordResponse(session); return session.lastResponse;
        } catch (failure) {
          if (controller.signal.aborted) throw failure;
          if (!(failure instanceof ReconstructionError) || ![409, 422].includes(failure.status)) throw failure;
          error = failure;
        }
      }
      if (error instanceof ReconstructionError && (error.status === 409 || error.status === 422)) {
        session.status = 'INVALIDATED'; session.reason = error.message; this.release(session); return this.view(session);
      }
      throw error;
    } finally { signal.removeEventListener('abort', abort); session.busy = false; session.controller = undefined; session.pendingGlobal = undefined; }
  }
  private readPage(session: Session, rows: IEsploraApi.Transaction[], mempool: boolean, tail = false) {
    if (addressHistoryProblems(rows, mempool ? MEMPOOL_PAGE : PAGE).length) throw new ReconstructionError(422, 'Invalid bounded transaction page');
    const stats = emptyStats(), txids = new Set<string>(), spent = new Set<string>(), outputs = new Map<string, ReconstructionOutput>();
    let bytes = 0, previousHeight = (tail ? session.tailLastHeight : session.lastHeight) ?? Number.POSITIVE_INFINITY;
    for (const transaction of rows) {
      if (transaction.status.confirmed === mempool || session.txids.has(transaction.txid) || txids.has(transaction.txid)) throw new ReconstructionError(422, 'Duplicate transaction or incorrect history phase');
      if (!mempool && (transaction.status.block_height! > (tail ? session.tailAnchor!.checkpoint.blockHeight : session.snapshot.checkpoint.blockHeight) ||
          tail && transaction.status.block_height! <= session.snapshot.checkpoint.blockHeight || transaction.status.block_height! > previousHeight)) throw new ReconstructionError(422, 'History order or checkpoint is invalid');
      previousHeight = transaction.status.block_height!;
      txids.add(transaction.txid); stats.transactions++; bytes += mempool ? 384 : 192;
      let transactionValue = 0n;
      transaction.vout.forEach((output, vout) => {
        if (!validAmount(output.value) || typeof output.scriptpubkey !== 'string' || output.scriptpubkey.length > 20000 || !/^(?:[0-9a-f]{2})*$/.test(output.scriptpubkey)) throw new ReconstructionError(422, 'Invalid exact output contract');
        transactionValue += BigInt(output.value);
        if (output.scriptpubkey === session.snapshot.scriptPubKey) {
          const key = point(transaction.txid, vout);
          const status: IEsploraApi.Status = transaction.status.confirmed
            ? { confirmed: true, block_height: transaction.status.block_height, block_hash: transaction.status.block_hash, block_time: transaction.status.block_time }
            : { confirmed: false };
          const item = { txid: transaction.txid, vout, value: output.value, status, scriptpubkey: output.scriptpubkey };
          outputs.set(key, item); stats.funded++; stats.fundedSum += BigInt(output.value);
          bytes += 256 + Buffer.byteLength(JSON.stringify(item)) * 4;
        }
      });
      if (transactionValue > MAX_MONEY) throw new ReconstructionError(422, 'Transaction output sum exceeds Bitcoin money range');
      for (const input of transaction.vin) {
        if (typeof input.is_coinbase !== 'boolean') throw new ReconstructionError(422, 'Invalid coinbase identity');
        if (input.is_coinbase === true) continue;
        if (!input.prevout || !validAmount(input.prevout.value) || !/^[0-9a-f]{64}$/.test(input.txid) ||
            typeof input.prevout.scriptpubkey !== 'string' || input.prevout.scriptpubkey.length > 20000 || !/^(?:[0-9a-f]{2})*$/.test(input.prevout.scriptpubkey) || !Number.isSafeInteger(input.vout) || input.vout < 0 || input.vout > 0xffffffff) throw new ReconstructionError(422, 'Missing or invalid exact prevout contract');
        if (input.prevout.scriptpubkey === session.snapshot.scriptPubKey) {
          const key = point(input.txid, input.vout);
          if (session.spent.has(key) || spent.has(key)) throw new ReconstructionError(422, 'Duplicate spent outpoint');
          spent.add(key); stats.spent++; stats.spentSum += BigInt(input.prevout.value); bytes += mempool ? 768 : 384;
        }
      }
    }
    if (session.txids.size + txids.size > MAX_TRANSACTIONS || session.outputs.size + outputs.size > MAX_OUTPUTS ||
        session.bytes + bytes + (session.pendingGlobal?.state.bytes || session.global.bytes) - session.global.bytes > MAX_BYTES) throw new ReconstructionError(422, 'Reconstruction retained memory capacity exceeded');
    const current = mempool ? session.mempool : tail ? session.tail : session.confirmed;
    const expected = mempool ? session.mempoolAnchor!.summary.mempool_stats : tail ? session.tailAnchor!.summary.chain_stats : session.snapshot.summary.chain_stats;
    if (current.transactions + stats.transactions + (tail ? session.confirmed.transactions : 0) > expected.tx_count) throw new ReconstructionError(422, 'History transaction count exceeds source closure');
    return { stats, txids, spent, outputs, bytes };
  }
  private addStats(left: Stats, right: Stats): Stats {
    return { transactions: left.transactions + right.transactions, funded: left.funded + right.funded,
      spent: left.spent + right.spent, fundedSum: left.fundedSum + right.fundedSum, spentSum: left.spentSum + right.spentSum };
  }
  private assertStats(stats: Stats, expected: IEsploraApi.ChainStats): void {
    if (stats.transactions !== expected.tx_count || stats.funded !== expected.funded_txo_count || stats.spent !== expected.spent_txo_count ||
        stats.fundedSum !== BigInt(expected.funded_txo_sum) || stats.spentSum !== BigInt(expected.spent_txo_sum)) throw new ReconstructionError(422, 'History counts and atomic sums do not close against source statistics');
  }
  private finishHistory(session: Session): void {
    for (const key of session.spent) if (!session.outputs.has(key)) throw new ReconstructionError(422, 'Spent outpoint has no funding transaction in complete history');
    session.candidates = [...session.outputs.entries()].filter(([key]) => !session.spent.has(key)).map(([, output]) => output);
    const expectedCount = session.confirmed.funded + session.tail.funded + session.mempool.funded - session.confirmed.spent - session.tail.spent - session.mempool.spent;
    const expectedSum = session.confirmed.fundedSum + session.tail.fundedSum + session.mempool.fundedSum - session.confirmed.spentSum - session.tail.spentSum - session.mempool.spentSum;
    if (session.candidates.length !== expectedCount || session.candidates.reduce((sum, item) => sum + BigInt(item.value), 0n) !== expectedSum ||
        utxoListProblems(session.candidates, MAX_OUTPUTS).length) throw new ReconstructionError(422, 'Reconstructed UTXO count or atomic balance does not close');
    session.phase = 'outspends';
  }
  private view(session: Session): UtxoReconstructionV4View {
    const complete = session.status === 'COMPLETE_AT_OBSERVED_TIP';
    return { schema: 'universe-address-utxo-reconstruction-v4', sessionId: session.id, cursor: session.cursor,
      address: session.address, network: this.network, status: session.status, reason: session.reason,
      confirmedAnchor: { ...session.snapshot.checkpoint, sourceId: session.snapshot.sourceId,
        scriptPubKey: session.snapshot.scriptPubKey, chainStats: exactStats(session.snapshot.summary.chain_stats) },
      latestObservedTip: { ...session.latestObservedTip },
      confirmedTailAnchor: session.tailClosed && session.tailAnchor ? { checkpoint: { ...session.tailAnchor.checkpoint }, chainStats: exactStats(session.tailAnchor.summary.chain_stats) } : null,
      mempoolAnchor: session.mempoolAnchor ? { identity: session.mempoolAnchor.mempoolIdentity,
        observedAt: session.mempoolObservedAt!, checkpoint: { ...session.mempoolAnchor.checkpoint }, addressMempoolStats: exactStats(session.mempoolAnchor.summary.mempool_stats) } : null,
      observedAt: new Date(this.now()).toISOString(), expiresAt: new Date(session.expires).toISOString(),
      globalMempoolProof: { mode: session.global.mode, fallbackReason: session.global.fallbackReason, maximumTransactions: 100, maximumRetainedBytes: 524288,
        retainedBytes: session.global.bytes, transactionCount: session.mempoolAnchor?.globalMempool.transactionCount ?? null, sequenceAtomic: session.mempoolAnchor?.globalMempool.sequenceAtomic ?? null,
        initialIdentity: session.global.initialIdentity, transitionCount: session.global.transitionCount, maximumTransitions: 128, maximumRetainedTransitions: 8,
        transitions: session.global.transitions.map(transition => ({ ...transition, addedTxids: [...transition.addedTxids], removedTxids: [...transition.removedTxids] })),
        verifiedOutputContext: (session.verified > 0 || complete) && session.global.verifiedIdentity && session.mempoolAnchor ? { identity: session.global.verifiedIdentity,
          checkpoint: { ...session.mempoolAnchor.checkpoint }, outpointsSha256: digest(session.candidates.slice(0, session.verified).map(output => ({ txid: output.txid, vout: output.vout, valueAtomic: String(output.value), scriptPubKey: output.scriptpubkey }))), outputCount: session.verified } : null },
      progress: { phase: session.phase, pageLimit: PAGE, mempoolEpoch: session.mempoolEpoch, confirmedEpoch: session.confirmedEpoch, confirmedTransactionsProcessed: session.confirmed.transactions,
        confirmedTransactionsExpected: session.snapshot.summary.chain_stats.tx_count,
        confirmedTailTransactionsProcessed: session.tail.transactions,
        confirmedTailTransactionsExpected: session.tailAnchor ? session.tailAnchor.summary.chain_stats.tx_count - session.snapshot.summary.chain_stats.tx_count : null,
        mempoolTransactionsProcessed: session.mempool.transactions, mempoolTransactionsExpected: session.mempoolAnchor?.summary.mempool_stats.tx_count ?? null,
        candidateOutputs: session.candidates.length, verifiedOutputs: session.verified, retainedBytes: session.bytes },
      ...(complete ? { result: { outputCount: session.candidates.length,
        balanceAtomic: session.candidates.reduce((sum, item) => sum + BigInt(item.value), 0n).toString(),
        items: session.candidates.map(item => ({ txid: item.txid, vout: item.vout, valueAtomic: String(item.value), status: item.status })) } } : {}),
    };
  }
}
