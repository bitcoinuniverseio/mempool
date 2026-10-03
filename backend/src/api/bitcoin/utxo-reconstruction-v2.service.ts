import { randomUUID } from 'crypto';
import { IEsploraApi } from './esplora-api.interface';
import { addressHistoryProblems, addressSummaryProblems, utxoListProblems } from './esplora-contract';
import { UtxoReconstructionV2View } from './utxo-reconstruction-v2.types';

import { ReconstructionError, ReconstructionOutput, ReconstructionSnapshot, ReconstructionSource } from './utxo-reconstruction.service';
import { ConfirmedReconstructionSnapshot } from './utxo-reconstruction.source';
export interface ReconstructionV2Source extends ReconstructionSource {
  confirmedSnapshot(address: string, signal: AbortSignal): Promise<ConfirmedReconstructionSnapshot>;
}
class ConfirmedAnchorChanged extends ReconstructionError {
  constructor() { super(409, 'Confirmed chain, address statistics or source identity changed'); }
}
class MempoolAnchorChanged extends ReconstructionError {
  constructor() { super(409, 'MEMPOOL_CHANGED'); }
}
const PAGE = 100, MEMPOOL_PAGE = 500, OUTPUT_PAGE = 100, MAX_TRANSACTIONS = 100000, MAX_OUTPUTS = 100000;
const MAX_BYTES = 32 * 1024 * 1024, MAX_SESSIONS = 8, TTL = 30 * 60 * 1000;
const MAX_MONEY = 2100000000000000n;
type Stats = { transactions: number; funded: number; spent: number; fundedSum: bigint; spentSum: bigint };
const emptyStats = (): Stats => ({ transactions: 0, funded: 0, spent: 0, fundedSum: 0n, spentSum: 0n });
interface Session {
  id: string; address: string; snapshot: ConfirmedReconstructionSnapshot; mempoolAnchor?: ReconstructionSnapshot; mempoolObservedAt?: string; mempoolEpoch: number; expires: number; cursor: number;
  phase: 'confirmed' | 'acquire-mempool' | 'mempool' | 'outspends' | 'complete';
  status: UtxoReconstructionV2View['status']; reason?: string; lastTx?: string;
  lastHeight?: number;
  confirmed: Stats; mempool: Stats; mempoolTxids: Set<string>; mempoolSpent: Set<string>; mempoolOutputs: Set<string>; mempoolBytes: number; txids: Set<string>; spent: Set<string>;
  outputs: Map<string, ReconstructionOutput>; candidates: ReconstructionOutput[];
  verified: number; bytes: number; busy: boolean; controller?: AbortController;
  lastInput?: number; lastResponse?: UtxoReconstructionV2View;
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
  checkpoint: [s.checkpoint.genesisHash, s.checkpoint.blockHeight, s.checkpoint.blockHash, s.checkpoint.network, s.checkpoint.signetChallenge],
  summary: exactStats(s.summary.chain_stats),
});
const validAmount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && BigInt(v as number) <= MAX_MONEY;
const requireActive = (signal: AbortSignal): void => { if (signal.aborted) throw new ReconstructionError(499, 'Reconstruction request cancelled or exceeded its deadline'); };

/** Bounded, explicit history reconstruction. Full transactions are never retained. */
export class UtxoReconstructionV2Service {
  private sessions = new Map<string, Session>();
  private pendingCreates = 0;
  constructor(private source: ReconstructionV2Source, private network: string, private now = () => Date.now()) {}

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
  async create(address: string, signal: AbortSignal): Promise<UtxoReconstructionV2View> {
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
      // Retain only the specified fixed-size summary, never arbitrary upstream fields.
      snapshot.summary = exactSummary(snapshot.summary);
      if (snapshot.summary.chain_stats.tx_count > MAX_TRANSACTIONS || snapshot.summary.chain_stats.funded_txo_count > MAX_OUTPUTS) throw new ReconstructionError(422, 'Address exceeds bounded reconstruction capacity');
      const session: Session = { id: randomUUID(), address, snapshot, expires: this.now() + TTL, cursor: 0,
        phase: 'confirmed', status: 'PARTIAL', confirmed: emptyStats(), mempool: emptyStats(), mempoolEpoch: 0,
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
  cancel(address: string, id: string): UtxoReconstructionV2View {
    const session = this.find(address, id); session.controller?.abort();
    session.status = 'CANCELLED'; session.reason = 'Explicitly cancelled'; this.release(session); return this.view(session);
  }
  private release(session: Session): void { session.outputs.clear(); session.txids.clear(); session.spent.clear(); session.candidates = []; session.bytes = 0; session.lastResponse = undefined; session.mempoolTxids.clear(); session.mempoolSpent.clear(); session.mempoolOutputs.clear(); session.mempoolBytes = 0; }
  private cancelled(session: Session): boolean { return session.status === 'CANCELLED'; }
  private matches(session: Session, snapshot: ReconstructionSnapshot | ConfirmedReconstructionSnapshot): void {
    this.checkSnapshot(snapshot, session.address);
    if (identity(snapshot) !== identity(session.snapshot)) throw new ConfirmedAnchorChanged();
  }
  private matchesMempool(session: Session, snapshot: ReconstructionSnapshot): void {
    this.matches(session, snapshot);
    if (!session.mempoolAnchor || snapshot.mempoolIdentity !== session.mempoolAnchor.mempoolIdentity ||
      JSON.stringify(exactStats(snapshot.summary.mempool_stats)) !== JSON.stringify(exactStats(session.mempoolAnchor.summary.mempool_stats))) throw new MempoolAnchorChanged();
  }
  private resetMempool(session: Session): void {
    for (const txid of session.mempoolTxids) session.txids.delete(txid);
    for (const key of session.mempoolSpent) session.spent.delete(key);
    for (const key of session.mempoolOutputs) session.outputs.delete(key);
    session.bytes -= session.mempoolBytes;
    session.mempoolTxids.clear(); session.mempoolSpent.clear(); session.mempoolOutputs.clear(); session.mempoolBytes = 0;
    session.mempool = emptyStats(); session.mempoolAnchor = undefined; session.mempoolObservedAt = undefined;
    session.candidates = []; session.verified = 0; session.phase = 'acquire-mempool';
    session.status = 'PARTIAL'; session.reason = 'MEMPOOL_CHANGED'; session.mempoolEpoch++;
    session.lastResponse = undefined;
  }
  async next(address: string, id: string, cursor: number, signal: AbortSignal): Promise<UtxoReconstructionV2View> {
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
      const before = await this.source.confirmedSnapshot(address, controller.signal);
      this.matches(session, before);
      requireActive(controller.signal);
      if (session.mempoolAnchor) this.matchesMempool(session, await this.source.snapshot(address, controller.signal));
      if (replay || session.status === 'COMPLETE_AT_OBSERVED_TIP') {
        session.snapshot.checkpoint.verifiedAt = before.checkpoint.verifiedAt;
        session.lastResponse = this.view(session); return session.lastResponse;
      }
      if (session.phase === 'acquire-mempool') {
        const anchor = await this.source.snapshot(address, controller.signal);
        this.matches(session, anchor); requireActive(controller.signal);
        if (anchor.summary.mempool_stats.tx_count > MEMPOOL_PAGE ||
          session.confirmed.transactions + anchor.summary.mempool_stats.tx_count > MAX_TRANSACTIONS ||
          session.confirmed.funded + anchor.summary.mempool_stats.funded_txo_count > MAX_OUTPUTS) throw new ReconstructionError(422, 'Address mempool exceeds bounded reconstruction capacity');
        anchor.summary = exactSummary(anchor.summary);
        session.mempoolAnchor = anchor; session.mempoolObservedAt = new Date(this.now()).toISOString();
        session.phase = 'mempool'; session.reason = undefined;
      } else if (session.phase === 'outspends') {
        const outputs = session.candidates.slice(session.verified, session.verified + OUTPUT_PAGE);
        await this.source.verifyOutputs(outputs, controller.signal, session.snapshot.checkpoint);
        requireActive(controller.signal);
        const after = await this.source.snapshot(address, controller.signal);
        this.matchesMempool(session, after);
        requireActive(controller.signal);
        if (this.cancelled(session)) return this.view(session);
        session.verified += outputs.length;
        session.snapshot.checkpoint.verifiedAt = after.checkpoint.verifiedAt;
        if (session.verified === session.candidates.length) { session.phase = 'complete'; session.status = 'COMPLETE_AT_OBSERVED_TIP'; }
      } else {
        const mempool = session.phase === 'mempool';
        const rows = mempool ? await this.source.mempool(address, MEMPOOL_PAGE, controller.signal)
          : await this.source.history(address, session.lastTx, PAGE, controller.signal);
        requireActive(controller.signal);
        const delta = this.readPage(session, rows, mempool);
        const after = mempool ? await this.source.snapshot(address, controller.signal) : await this.source.confirmedSnapshot(address, controller.signal);
        if (mempool) this.matchesMempool(session, after as ReconstructionSnapshot); else this.matches(session, after);
        requireActive(controller.signal);
        if (this.cancelled(session)) return this.view(session);
        // Commit progress only after the bounded page and source checks succeed.
        for (const txid of delta.txids) session.txids.add(txid);
        for (const key of delta.spent) session.spent.add(key);
        for (const [key, output] of delta.outputs) session.outputs.set(key, output);
        const stats = mempool ? session.mempool : session.confirmed;
        for (const key of ['transactions', 'funded', 'spent'] as const) stats[key] += delta.stats[key];
        stats.fundedSum += delta.stats.fundedSum; stats.spentSum += delta.stats.spentSum;
        session.bytes += delta.bytes;
        if (mempool) {
          session.mempoolBytes += delta.bytes;
          for (const txid of delta.txids) session.mempoolTxids.add(txid);
          for (const key of delta.spent) session.mempoolSpent.add(key);
          for (const key of delta.outputs.keys()) session.mempoolOutputs.add(key);
        }
        session.snapshot.checkpoint.verifiedAt = after.checkpoint.verifiedAt;
        if (!mempool && rows.length) session.lastTx = rows[rows.length - 1].txid;
        if (!mempool && rows.length) session.lastHeight = rows[rows.length - 1].status.block_height;
        if (mempool) { this.assertStats(stats, session.mempoolAnchor!.summary.mempool_stats); this.finishHistory(session); }
        else if (!rows.length) { this.assertStats(stats, session.snapshot.summary.chain_stats); session.phase = 'acquire-mempool'; }
      }
      session.cursor++; session.lastInput = cursor; session.lastResponse = this.view(session); return session.lastResponse;
    } catch (caught) {
      let error = caught;
      if (this.cancelled(session)) return this.view(session);
      // Transport cancellation/deadline leaves the original cursor retryable.
      if (controller.signal.aborted) throw error;
      if (error instanceof ReconstructionError && error.status === 409 && !(error instanceof ConfirmedAnchorChanged) && session.phase !== 'confirmed') {
        // Only retain confirmed progress after a separate fresh chain check.
        try {
          const confirmed = await this.source.confirmedSnapshot(address, controller.signal);
          this.matches(session, confirmed); requireActive(controller.signal);
          if (error instanceof MempoolAnchorChanged || !session.mempoolAnchor) {
            this.resetMempool(session);
          } else {
            // A genuine output mismatch with unchanged mempool remains invalid.
            let latest: ReconstructionSnapshot | undefined;
            try { latest = await this.source.snapshot(address, controller.signal); }
            catch (failure) { if (!(failure instanceof ReconstructionError) || failure.status !== 409) throw failure; }
            if (latest) {
              this.matches(session, latest);
              if (latest.mempoolIdentity === session.mempoolAnchor.mempoolIdentity &&
                JSON.stringify(exactStats(latest.summary.mempool_stats)) === JSON.stringify(exactStats(session.mempoolAnchor.summary.mempool_stats))) throw error;
            }
            this.resetMempool(session);
          }
          session.snapshot.checkpoint.verifiedAt = confirmed.checkpoint.verifiedAt;
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
  private readPage(session: Session, rows: IEsploraApi.Transaction[], mempool: boolean) {
    if (addressHistoryProblems(rows, mempool ? MEMPOOL_PAGE : PAGE).length) throw new ReconstructionError(422, 'Invalid bounded transaction page');
    const stats = emptyStats(), txids = new Set<string>(), spent = new Set<string>(), outputs = new Map<string, ReconstructionOutput>();
    let bytes = 0, previousHeight = session.lastHeight ?? Number.POSITIVE_INFINITY;
    for (const transaction of rows) {
      if (transaction.status.confirmed === mempool || session.txids.has(transaction.txid) || txids.has(transaction.txid)) throw new ReconstructionError(422, 'Duplicate transaction or incorrect history phase');
      if (!mempool && (transaction.status.block_height! > session.snapshot.checkpoint.blockHeight || transaction.status.block_height! > previousHeight)) throw new ReconstructionError(422, 'History order or checkpoint is invalid');
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
    const current = mempool ? session.mempool : session.confirmed, expected = mempool ? session.mempoolAnchor!.summary.mempool_stats : session.snapshot.summary.chain_stats;
    if (current.transactions + stats.transactions > expected.tx_count) throw new ReconstructionError(422, 'History transaction count exceeds source closure');
    return { stats, txids, spent, outputs, bytes };
  }
  private assertStats(stats: Stats, expected: IEsploraApi.ChainStats): void {
    if (stats.transactions !== expected.tx_count || stats.funded !== expected.funded_txo_count || stats.spent !== expected.spent_txo_count ||
        stats.fundedSum !== BigInt(expected.funded_txo_sum) || stats.spentSum !== BigInt(expected.spent_txo_sum)) throw new ReconstructionError(422, 'History counts and atomic sums do not close against source statistics');
  }
  private finishHistory(session: Session): void {
    for (const key of session.spent) if (!session.outputs.has(key)) throw new ReconstructionError(422, 'Spent outpoint has no funding transaction in complete history');
    session.candidates = [...session.outputs.entries()].filter(([key]) => !session.spent.has(key)).map(([, output]) => output);
    const expectedCount = session.confirmed.funded + session.mempool.funded - session.confirmed.spent - session.mempool.spent;
    const expectedSum = session.confirmed.fundedSum + session.mempool.fundedSum - session.confirmed.spentSum - session.mempool.spentSum;
    if (session.candidates.length !== expectedCount || session.candidates.reduce((sum, item) => sum + BigInt(item.value), 0n) !== expectedSum ||
        utxoListProblems(session.candidates, MAX_OUTPUTS).length) throw new ReconstructionError(422, 'Reconstructed UTXO count or atomic balance does not close');
    session.phase = 'outspends';
  }
  private view(session: Session): UtxoReconstructionV2View {
    const complete = session.status === 'COMPLETE_AT_OBSERVED_TIP';
    return { schema: 'universe-address-utxo-reconstruction-v2', sessionId: session.id, cursor: session.cursor,
      address: session.address, network: this.network, status: session.status, reason: session.reason,
      confirmedAnchor: { ...session.snapshot.checkpoint, sourceId: session.snapshot.sourceId,
        scriptPubKey: session.snapshot.scriptPubKey, chainStats: exactStats(session.snapshot.summary.chain_stats) },
      mempoolAnchor: session.mempoolAnchor ? { identity: session.mempoolAnchor.mempoolIdentity,
        observedAt: session.mempoolObservedAt!, addressMempoolStats: exactStats(session.mempoolAnchor.summary.mempool_stats) } : null,
      observedAt: new Date(this.now()).toISOString(), expiresAt: new Date(session.expires).toISOString(),
      progress: { phase: session.phase, pageLimit: PAGE, mempoolEpoch: session.mempoolEpoch, confirmedTransactionsProcessed: session.confirmed.transactions,
        confirmedTransactionsExpected: session.snapshot.summary.chain_stats.tx_count,
        mempoolTransactionsProcessed: session.mempool.transactions, mempoolTransactionsExpected: session.mempoolAnchor?.summary.mempool_stats.tx_count ?? null,
        candidateOutputs: session.candidates.length, verifiedOutputs: session.verified, retainedBytes: session.bytes },
      ...(complete ? { result: { outputCount: session.candidates.length,
        balanceAtomic: session.candidates.reduce((sum, item) => sum + BigInt(item.value), 0n).toString(),
        items: session.candidates.map(item => ({ txid: item.txid, vout: item.vout, valueAtomic: String(item.value), status: item.status })) } } : {}),
    };
  }
}
