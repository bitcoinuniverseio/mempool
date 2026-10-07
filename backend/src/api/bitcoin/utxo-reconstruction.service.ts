import { randomUUID } from 'crypto';
import { IEsploraApi } from './esplora-api.interface';
import { AddressSourceCheckpoint } from './address-source-checkpoint';
import { addressHistoryProblems, addressSummaryProblems, utxoListProblems } from './esplora-contract';
import { UtxoReconstructionView } from './utxo-reconstruction.types';

export interface ReconstructionSnapshot {
  checkpoint: AddressSourceCheckpoint;
  sourceId: string;
  mempoolIdentity: string;
  scriptPubKey: string;
  summary: IEsploraApi.Address;
}
export interface ReconstructionOutput extends IEsploraApi.UTXO { scriptpubkey: string }
export interface ReconstructionSource {
  snapshot(address: string, signal: AbortSignal): Promise<ReconstructionSnapshot>;
  history(address: string, after: string | undefined, limit: number, signal: AbortSignal): Promise<IEsploraApi.Transaction[]>;
  mempool(address: string, limit: number, signal: AbortSignal): Promise<IEsploraApi.Transaction[]>;
  verifyOutputs(outputs: ReconstructionOutput[], signal: AbortSignal, checkpoint: AddressSourceCheckpoint): Promise<void>;
}
export class ReconstructionError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
const PAGE = 500, OUTPUT_PAGE = 100, MAX_TRANSACTIONS = 100000, MAX_OUTPUTS = 100000;
const MAX_BYTES = 32 * 1024 * 1024, MAX_SESSIONS = 8, TTL = 30 * 60 * 1000;
const MAX_MONEY = 2100000000000000n;
type Stats = { transactions: number; funded: number; spent: number; fundedSum: bigint; spentSum: bigint };
const emptyStats = (): Stats => ({ transactions: 0, funded: 0, spent: 0, fundedSum: 0n, spentSum: 0n });
interface Session {
  id: string; address: string; snapshot: ReconstructionSnapshot; expires: number; cursor: number;
  phase: 'confirmed' | 'mempool' | 'outspends' | 'complete';
  status: UtxoReconstructionView['status']; reason?: string; lastTx?: string;
  lastHeight?: number;
  confirmed: Stats; mempool: Stats; txids: Set<string>; spent: Set<string>;
  outputs: Map<string, ReconstructionOutput>; candidates: ReconstructionOutput[];
  verified: number; bytes: number; busy: boolean; controller?: AbortController;
  lastInput?: number; lastResponse?: UtxoReconstructionView;
}
const point = (txid: string, vout: number): string => `${txid}:${vout}`;
const exactStats = (s: IEsploraApi.ChainStats): IEsploraApi.ChainStats => ({
  funded_txo_count: s.funded_txo_count, funded_txo_sum: s.funded_txo_sum,
  spent_txo_count: s.spent_txo_count, spent_txo_sum: s.spent_txo_sum, tx_count: s.tx_count,
});
const exactSummary = (s: IEsploraApi.Address): IEsploraApi.Address => ({
  address: s.address, chain_stats: exactStats(s.chain_stats), mempool_stats: exactStats(s.mempool_stats),
});
const identity = (s: ReconstructionSnapshot): string => JSON.stringify({
  sourceId: s.sourceId, mempoolIdentity: s.mempoolIdentity, scriptPubKey: s.scriptPubKey,
  checkpoint: [s.checkpoint.genesisHash, s.checkpoint.blockHeight, s.checkpoint.blockHash, s.checkpoint.network, s.checkpoint.signetChallenge],
  summary: exactSummary(s.summary),
});
const validAmount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && BigInt(v as number) <= MAX_MONEY;
const requireActive = (signal: AbortSignal): void => { if (signal.aborted) throw new ReconstructionError(499, 'Reconstruction request cancelled or exceeded its deadline'); };

/** Bounded, explicit history reconstruction. Full transactions are never retained. */
export class UtxoReconstructionService {
  private sessions = new Map<string, Session>();
  private pendingCreates = 0;
  constructor(private source: ReconstructionSource, private network: string, private now = () => Date.now()) {}

  private prune(): void {
    for (const session of this.sessions.values()) if (session.expires <= this.now()) {
      session.controller?.abort(); this.sessions.delete(session.id);
    }
  }
  private checkSnapshot(snapshot: ReconstructionSnapshot, address: string): void {
    if (addressSummaryProblems(snapshot.summary, address).length || snapshot.checkpoint.network !== this.network ||
      !/^[0-9a-f]{64}$/.test(snapshot.checkpoint.genesisHash) || !/^[0-9a-f]{64}$/.test(snapshot.checkpoint.blockHash) ||
      !Number.isSafeInteger(snapshot.checkpoint.blockHeight) || snapshot.checkpoint.blockHeight < 0 ||
      !snapshot.sourceId || !/^[0-9a-f]{64}$/.test(snapshot.mempoolIdentity) || typeof snapshot.scriptPubKey !== 'string' ||
      snapshot.scriptPubKey.length > 20000 || !/^(?:[0-9a-f]{2})+$/.test(snapshot.scriptPubKey)) throw new ReconstructionError(503, 'Invalid reconstruction source contract');
  }
  /** @asyncUnsafe */
  async create(address: string, signal: AbortSignal): Promise<UtxoReconstructionView> {
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
      const snapshot = await this.source.snapshot(address, signal);
      requireActive(signal); this.checkSnapshot(snapshot, address);
      // Retain only the specified fixed-size summary, never arbitrary upstream fields.
      snapshot.summary = exactSummary(snapshot.summary);
      if (snapshot.summary.chain_stats.tx_count + snapshot.summary.mempool_stats.tx_count > MAX_TRANSACTIONS ||
          snapshot.summary.chain_stats.funded_txo_count + snapshot.summary.mempool_stats.funded_txo_count > MAX_OUTPUTS ||
          snapshot.summary.mempool_stats.tx_count > PAGE) throw new ReconstructionError(422, 'Address exceeds bounded reconstruction capacity');
      const session: Session = { id: randomUUID(), address, snapshot, expires: this.now() + TTL, cursor: 0,
        phase: 'confirmed', status: 'PARTIAL', confirmed: emptyStats(), mempool: emptyStats(),
        txids: new Set(), spent: new Set(), outputs: new Map(), candidates: [], verified: 0, bytes: 0, busy: false };
      this.sessions.set(session.id, session); return this.view(session);
    } finally { this.pendingCreates--; }
  }
  private find(address: string, id: string): Session {
    this.prune(); const session = this.sessions.get(id);
    if (!session || session.address !== address || session.snapshot.checkpoint.network !== this.network) throw new ReconstructionError(404, 'Reconstruction session not found in this address context');
    return session;
  }
  cancel(address: string, id: string): UtxoReconstructionView {
    const session = this.find(address, id); session.controller?.abort();
    session.status = 'CANCELLED'; session.reason = 'Explicitly cancelled'; this.release(session); return this.view(session);
  }
  private release(session: Session): void { session.outputs.clear(); session.txids.clear(); session.spent.clear(); session.candidates = []; session.bytes = 0; session.lastResponse = undefined; }
  private cancelled(session: Session): boolean { return session.status === 'CANCELLED'; }
  private matches(session: Session, snapshot: ReconstructionSnapshot): void {
    this.checkSnapshot(snapshot, session.address);
    if (identity(snapshot) !== identity(session.snapshot)) throw new ReconstructionError(409, 'Source checkpoint, address statistics or exact mempool identity changed');
  }
  async next(address: string, id: string, cursor: number, signal: AbortSignal): Promise<UtxoReconstructionView> {
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
      const before = await this.source.snapshot(address, controller.signal);
      this.matches(session, before);
      requireActive(controller.signal);
      if (replay || session.status === 'COMPLETE_AT_OBSERVED_TIP') {
        session.snapshot.checkpoint.verifiedAt = before.checkpoint.verifiedAt;
        session.lastResponse = this.view(session); return session.lastResponse;
      }
      if (session.phase === 'outspends') {
        const outputs = session.candidates.slice(session.verified, session.verified + OUTPUT_PAGE);
        await this.source.verifyOutputs(outputs, controller.signal, session.snapshot.checkpoint);
        requireActive(controller.signal);
        const after = await this.source.snapshot(address, controller.signal);
        this.matches(session, after);
        requireActive(controller.signal);
        if (this.cancelled(session)) return this.view(session);
        session.verified += outputs.length;
        session.snapshot.checkpoint.verifiedAt = after.checkpoint.verifiedAt;
        if (session.verified === session.candidates.length) { session.phase = 'complete'; session.status = 'COMPLETE_AT_OBSERVED_TIP'; }
      } else {
        const mempool = session.phase === 'mempool';
        const rows = mempool ? await this.source.mempool(address, PAGE, controller.signal)
          : await this.source.history(address, session.lastTx, PAGE, controller.signal);
        requireActive(controller.signal);
        const delta = this.readPage(session, rows, mempool);
        const after = await this.source.snapshot(address, controller.signal);
        this.matches(session, after);
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
        session.snapshot.checkpoint.verifiedAt = after.checkpoint.verifiedAt;
        if (rows.length) session.lastTx = rows[rows.length - 1].txid;
        if (!mempool && rows.length) session.lastHeight = rows[rows.length - 1].status.block_height;
        if (mempool) { this.assertStats(stats, session.snapshot.summary.mempool_stats); this.finishHistory(session); }
        else if (!rows.length) { this.assertStats(stats, session.snapshot.summary.chain_stats); session.phase = 'mempool'; }
      }
      session.cursor++; session.lastInput = cursor; session.lastResponse = this.view(session); return session.lastResponse;
    } catch (error) {
      if (this.cancelled(session)) return this.view(session);
      // Transport cancellation/deadline leaves the original cursor retryable.
      if (controller.signal.aborted) throw error;
      if (error instanceof ReconstructionError && (error.status === 409 || error.status === 422)) {
        session.status = 'INVALIDATED'; session.reason = error.message; this.release(session); return this.view(session);
      }
      throw error;
    } finally { signal.removeEventListener('abort', abort); session.busy = false; session.controller = undefined; }
  }
  private readPage(session: Session, rows: IEsploraApi.Transaction[], mempool: boolean) {
    if (addressHistoryProblems(rows, PAGE).length) throw new ReconstructionError(422, 'Invalid bounded transaction page');
    const stats = emptyStats(), txids = new Set<string>(), spent = new Set<string>(), outputs = new Map<string, ReconstructionOutput>();
    let bytes = 0, previousHeight = session.lastHeight ?? Number.POSITIVE_INFINITY;
    for (const transaction of rows) {
      if (transaction.status.confirmed === mempool || session.txids.has(transaction.txid) || txids.has(transaction.txid)) throw new ReconstructionError(422, 'Duplicate transaction or incorrect history phase');
      if (!mempool && (transaction.status.block_height! > session.snapshot.checkpoint.blockHeight || transaction.status.block_height! > previousHeight)) throw new ReconstructionError(422, 'History order or checkpoint is invalid');
      previousHeight = transaction.status.block_height!;
      txids.add(transaction.txid); stats.transactions++; bytes += 192;
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
          spent.add(key); stats.spent++; stats.spentSum += BigInt(input.prevout.value); bytes += 384;
        }
      }
    }
    if (session.txids.size + txids.size > MAX_TRANSACTIONS || session.outputs.size + outputs.size > MAX_OUTPUTS ||
        session.bytes + bytes > MAX_BYTES) throw new ReconstructionError(422, 'Reconstruction retained memory capacity exceeded');
    const current = mempool ? session.mempool : session.confirmed, expected = mempool ? session.snapshot.summary.mempool_stats : session.snapshot.summary.chain_stats;
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
  private view(session: Session): UtxoReconstructionView {
    const complete = session.status === 'COMPLETE_AT_OBSERVED_TIP';
    return { schema: 'universe-address-utxo-reconstruction-v1', sessionId: session.id, cursor: session.cursor,
      address: session.address, network: this.network, status: session.status, reason: session.reason,
      source: { ...session.snapshot.checkpoint, sourceId: session.snapshot.sourceId, mempoolIdentity: session.snapshot.mempoolIdentity, scriptPubKey: session.snapshot.scriptPubKey },
      observedAt: new Date(this.now()).toISOString(), expiresAt: new Date(session.expires).toISOString(),
      progress: { phase: session.phase, confirmedTransactionsProcessed: session.confirmed.transactions,
        confirmedTransactionsExpected: session.snapshot.summary.chain_stats.tx_count,
        mempoolTransactionsProcessed: session.mempool.transactions, mempoolTransactionsExpected: session.snapshot.summary.mempool_stats.tx_count,
        candidateOutputs: session.candidates.length, verifiedOutputs: session.verified, retainedBytes: session.bytes },
      ...(complete ? { result: { outputCount: session.candidates.length,
        balanceAtomic: session.candidates.reduce((sum, item) => sum + BigInt(item.value), 0n).toString(),
        items: session.candidates.map(item => ({ txid: item.txid, vout: item.vout, valueAtomic: String(item.value), status: item.status })) } } : {}),
    };
  }
}
