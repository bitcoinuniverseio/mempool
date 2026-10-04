import { randomUUID } from 'crypto';
import { IEsploraApi } from './esplora-api.interface';
import { addressHistoryProblems, addressSummaryProblems, utxoListProblems } from './esplora-contract';
import { UtxoReconstructionV3View } from './utxo-reconstruction-v3.types';

import { ReconstructionError, ReconstructionOutput, ReconstructionSnapshot, ReconstructionSource } from './utxo-reconstruction.service';
import { AnchoredReconstructionSnapshot, ConfirmedReconstructionSnapshot } from './utxo-reconstruction.source';
import { AddressSourceCheckpoint } from './address-source-checkpoint';
export interface ReconstructionV3Source extends ReconstructionSource {
  snapshot(address: string, signal: AbortSignal, anchor?: AddressSourceCheckpoint): Promise<AnchoredReconstructionSnapshot>;
  confirmedSnapshot(address: string, signal: AbortSignal, anchor?: AddressSourceCheckpoint): Promise<ConfirmedReconstructionSnapshot>;
  verifyHistoryBlocks(rows: IEsploraApi.Transaction[], signal: AbortSignal): Promise<void>;
}
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
// Fixed V3 lifetime covers bounded cold history paging plus manual continuation;
// it never slides and does not raise the retained memory or session limits.
const MAX_BYTES = 32 * 1024 * 1024, MAX_SESSIONS = 8, TTL = 60 * 60 * 1000;
const MAX_MONEY = 2100000000000000n;
type Stats = { transactions: number; funded: number; spent: number; fundedSum: bigint; spentSum: bigint };
const emptyStats = (): Stats => ({ transactions: 0, funded: 0, spent: 0, fundedSum: 0n, spentSum: 0n });
interface Session {
  id: string; address: string; snapshot: ConfirmedReconstructionSnapshot; mempoolAnchor?: ReconstructionSnapshot; mempoolObservedAt?: string; mempoolEpoch: number; expires: number; cursor: number;
  latestObservedTip: AddressSourceCheckpoint;
  phase: 'confirmed' | 'reconcile-confirmed' | 'acquire-mempool' | 'mempool' | 'outspends' | 'complete';
  baseHead?: string; tailAnchor?: ConfirmedReconstructionSnapshot; tailClosed: boolean; confirmedEpoch: number;
  tail: Stats; tailTxids: Set<string>; tailSpent: Set<string>; tailOutputs: Set<string>; tailBytes: number;
  tailLastTx?: string; tailLastHeight?: number;
  scanLastHeight?: number; tailScanLastHeight?: number;
  prefixRowsObserved: number;
  status: UtxoReconstructionV3View['status']; reason?: string; lastTx?: string;
  lastHeight?: number;
  confirmed: Stats; mempool: Stats; mempoolTxids: Set<string>; mempoolSpent: Set<string>; mempoolOutputs: Set<string>; mempoolBytes: number; txids: Set<string>; spent: Set<string>;
  outputs: Map<string, ReconstructionOutput>; candidates: ReconstructionOutput[];
  verified: number; bytes: number; busy: boolean; controller?: AbortController;
  lastInput?: number; lastResponse?: UtxoReconstructionV3View;
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
export class UtxoReconstructionV3Service {
  private sessions = new Map<string, Session>();
  private pendingCreates = 0;
  constructor(private source: ReconstructionV3Source, private network: string, private now = () => Date.now()) {}

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
  async create(address: string, signal: AbortSignal): Promise<UtxoReconstructionV3View> {
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
      const session: Session = { id: randomUUID(), address, snapshot, latestObservedTip: { ...snapshot.checkpoint }, expires: this.now() + TTL, cursor: 0,
        phase: 'confirmed', status: 'PARTIAL', confirmed: emptyStats(), mempool: emptyStats(), mempoolEpoch: 0,
        tail: emptyStats(), tailTxids: new Set(), tailSpent: new Set(), tailOutputs: new Set(), tailBytes: 0,
        tailClosed: false, confirmedEpoch: 0,
        prefixRowsObserved: 0,
        mempoolTxids: new Set(), mempoolSpent: new Set(), mempoolOutputs: new Set(), mempoolBytes: 0,
        txids: new Set(), spent: new Set(), outputs: new Map(), candidates: [], verified: 0, bytes: 0, busy: false };
      this.sessions.set(session.id, session); return this.view(session);
    } finally { this.pendingCreates--; }
  }
  private find(address: string, id: string): Session {
    this.prune(); const session = this.sessions.get(id);
    if (!session || session.address !== address || session.snapshot.checkpoint.network !== this.network) throw new ReconstructionError(404, 'Reconstruction session not found in this address context');
    return session;
  }
  cancel(address: string, id: string): UtxoReconstructionV3View {
    const session = this.find(address, id); session.controller?.abort();
    session.status = 'CANCELLED'; session.reason = 'Explicitly cancelled'; this.release(session); return this.view(session);
  }
  private release(session: Session): void { session.outputs.clear(); session.txids.clear(); session.spent.clear(); session.candidates = []; session.bytes = 0; session.lastResponse = undefined; session.mempoolTxids.clear(); session.mempoolSpent.clear(); session.mempoolOutputs.clear(); session.mempoolBytes = 0; session.tailTxids.clear(); session.tailSpent.clear(); session.tailOutputs.clear(); session.tailBytes = 0; }
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
  private matchesMempool(session: Session, snapshot: AnchoredReconstructionSnapshot): void {
    this.matchesTail(session, snapshot);
    if (session.mempoolAnchor && (snapshot.checkpoint.blockHeight !== session.mempoolAnchor.checkpoint.blockHeight ||
        snapshot.checkpoint.blockHash !== session.mempoolAnchor.checkpoint.blockHash)) throw new MempoolAnchorChanged('FINAL_TIP_CHANGED');
    if (!session.mempoolAnchor || snapshot.mempoolIdentity !== session.mempoolAnchor.mempoolIdentity ||
      JSON.stringify(exactStats(snapshot.summary.mempool_stats)) !== JSON.stringify(exactStats(session.mempoolAnchor.summary.mempool_stats))) throw new MempoolAnchorChanged();
  }
  private resetMempool(session: Session, reason = 'MEMPOOL_CHANGED'): void {
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
  async next(address: string, id: string, cursor: number, signal: AbortSignal): Promise<UtxoReconstructionV3View> {
    const session = this.find(address, id);
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
      if (session.mempoolAnchor) this.matchesMempool(session, await this.source.snapshot(address, controller.signal, session.snapshot.checkpoint));
      if (replay || session.status === 'COMPLETE_AT_OBSERVED_TIP') {
        this.activeSession(session, controller.signal);
        session.lastResponse = this.view(session); return session.lastResponse;
      }
      if (session.phase === 'acquire-mempool') {
        const anchor = await this.source.snapshot(address, controller.signal, session.snapshot.checkpoint);
        this.matchesTail(session, anchor); requireActive(controller.signal);
        this.activeSession(session, controller.signal);
        if (anchor.summary.mempool_stats.tx_count > MEMPOOL_PAGE ||
          session.confirmed.transactions + session.tail.transactions + anchor.summary.mempool_stats.tx_count > MAX_TRANSACTIONS ||
          session.confirmed.funded + session.tail.funded + anchor.summary.mempool_stats.funded_txo_count > MAX_OUTPUTS) throw new ReconstructionError(422, 'Address mempool exceeds bounded reconstruction capacity');
        anchor.summary = exactSummary(anchor.summary);
        session.mempoolAnchor = anchor; session.mempoolObservedAt = new Date(this.now()).toISOString();
        session.phase = 'mempool'; session.reason = undefined;
      } else if (session.phase === 'outspends') {
        const outputs = session.candidates.slice(session.verified, session.verified + OUTPUT_PAGE);
        await this.source.verifyOutputs(outputs, controller.signal, session.mempoolAnchor!.checkpoint);
        requireActive(controller.signal);
        const after = await this.source.snapshot(address, controller.signal, session.snapshot.checkpoint);
        this.matchesMempool(session, after);
        requireActive(controller.signal);
        this.activeSession(session, controller.signal);
        if (this.cancelled(session)) return this.view(session);
        session.verified += outputs.length;
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
        if (mempool) this.matchesMempool(session, after as ReconstructionSnapshot);
        else if (tail) this.matchesTail(work, after);
        else this.matches(session, after);
        requireActive(controller.signal);
        if (this.cancelled(session)) return this.view(session);
        this.activeSession(session, controller.signal);
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
        if (mempool) { this.assertStats(stats, session.mempoolAnchor!.summary.mempool_stats); this.finishHistory(session); }
        else if (tail && boundaryReached) { session.tailClosed = true; session.phase = 'acquire-mempool'; }
        else if (!tail && !rows.length) session.phase = 'reconcile-confirmed';
      }
      session.cursor++; session.lastInput = cursor; session.lastResponse = this.view(session); return session.lastResponse;
    } catch (caught) {
      let error = caught;
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
        session.lastResponse = this.view(session); return session.lastResponse;
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
            session.lastResponse = this.view(session); return session.lastResponse;
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
          session.cursor++; session.lastInput = cursor; session.lastResponse = this.view(session); return session.lastResponse;
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
    } finally { signal.removeEventListener('abort', abort); session.busy = false; session.controller = undefined; }
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
        session.bytes + bytes > MAX_BYTES) throw new ReconstructionError(422, 'Reconstruction retained memory capacity exceeded');
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
  private view(session: Session): UtxoReconstructionV3View {
    const complete = session.status === 'COMPLETE_AT_OBSERVED_TIP';
    return { schema: 'universe-address-utxo-reconstruction-v3', sessionId: session.id, cursor: session.cursor,
      address: session.address, network: this.network, status: session.status, reason: session.reason,
      confirmedAnchor: { ...session.snapshot.checkpoint, sourceId: session.snapshot.sourceId,
        scriptPubKey: session.snapshot.scriptPubKey, chainStats: exactStats(session.snapshot.summary.chain_stats) },
      latestObservedTip: { ...session.latestObservedTip },
      confirmedTailAnchor: session.tailClosed && session.tailAnchor ? { checkpoint: { ...session.tailAnchor.checkpoint }, chainStats: exactStats(session.tailAnchor.summary.chain_stats) } : null,
      mempoolAnchor: session.mempoolAnchor ? { identity: session.mempoolAnchor.mempoolIdentity,
        observedAt: session.mempoolObservedAt!, checkpoint: { ...session.mempoolAnchor.checkpoint }, addressMempoolStats: exactStats(session.mempoolAnchor.summary.mempool_stats) } : null,
      observedAt: new Date(this.now()).toISOString(), expiresAt: new Date(session.expires).toISOString(),
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
