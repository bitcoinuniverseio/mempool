import * as crypto from 'crypto';
import config from '../../../config';
import mempool from '../../mempool';
import { BlockExtended, MempoolTransactionExtended, TransactionExtended } from '../../../mempool.interfaces';

/**
 * Mempool time machine over what this backend has actually observed.
 *
 * The revision this replaces seeded five checkpoints with invented block
 * hashes, added 120,000 to the event count, invented a coverage gap, and
 * answered a lifecycle for any txid with two events nobody observed. Now a
 * checkpoint is a snapshot of the real mempool taken when a block arrived,
 * a lifecycle event is one the mempool loop reported, coverage is exactly
 * the observed window, and a request outside it is answered with the
 * unavailable state rather than a guess.
 */

export interface HistoricalMempoolEvent {
  event_id: string;
  txid: string;
  timestamp_utc: string;
  event_type: 'observed' | 'accepted' | 'removed' | 'confirmed' | 'replaced' | 'conflicted' | 'evicted' | 'reaccepted_after_reorg';
  vsize: number;
  fee_sats: number;
  fee_rate: number;
  block_height?: number;
  replaced_by_txid?: string;
}

export interface MempoolCheckpoint {
  checkpoint_id: string;
  network: string;
  block_height: number;
  block_hash: string;
  timestamp_utc: string;
  /** The mempool as it stood when this block was processed. */
  mempool_tx_count: number;
  mempool_vsize: number;
  mempool_weight: number;
  mempool_fees_sats: number;
  median_feerate_sats_vb: number;
  fee_distribution: Array<{ feerate_bucket: string; count: number; total_vsize: number }>;
  /** The block itself. */
  block_tx_count: number;
  block_weight: number;
  block_fees_sats: number;
  state_hash: string;
}

export interface ReplayStateSummary {
  state_hash: string;
  target_timestamp_utc: string;
  target_block_height: number;
  nearest_checkpoint_id: string;
  checkpoint_block_hash: string;
  applied_events_count: number;
  total_transactions: number;
  total_vsize: number;
  total_weight: number;
  total_fees_sats: number;
  median_feerate_sats_vb: number;
  fee_distribution: Array<{ feerate_bucket: string; count: number; total_vsize: number }>;
  projected_blocks_count: number;
  coverage_status: 'complete' | 'partial' | 'gap_detected';
  gap_intervals: Array<{ start_utc: string; end_utc: string; reason: string }>;
}

export interface ReplayComparisonReport {
  state_a: ReplayStateSummary;
  state_b: ReplayStateSummary;
  delta: {
    tx_count_delta: number;
    weight_delta: number;
    fees_delta_sats: number;
    median_feerate_delta: number;
    added_txids: string[];
    removed_txids: string[];
  };
}

export class TimeMachineUnavailableError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
}

const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '1-5 sat/vB', min: 0, max: 5 }, { label: '6-10 sat/vB', min: 5, max: 10 }, { label: '11-20 sat/vB', min: 10, max: 20 },
  { label: '21-50 sat/vB', min: 20, max: 50 }, { label: '50+ sat/vB', min: 50, max: Infinity },
];

export const TIME_MACHINE_LIMITS = { checkpoints: 288, events: 50_000, eventsPerTx: 64 } as const;

export class TimeMachineService {
  private static instance: TimeMachineService;
  private eventLog: HistoricalMempoolEvent[] = [];
  private checkpoints: MempoolCheckpoint[] = [];
  private stateCache: Map<string, { summary: ReplayStateSummary; txids: Set<string> }> = new Map();
  private startedAt = new Date().toISOString();
  private lifecycleFeed: () => { [txid: string]: MempoolTransactionExtended } = () => mempool.getMempool();

  private constructor() {}

  public static getInstance(): TimeMachineService {
    if (!TimeMachineService.instance) {
      TimeMachineService.instance = new TimeMachineService();
    }
    return TimeMachineService.instance;
  }

  /** Test seam: an alternative mempool reader and a clean slate. */
  public resetForTests(feed?: () => { [txid: string]: MempoolTransactionExtended }): void {
    this.eventLog = [];
    this.checkpoints = [];
    this.stateCache.clear();
    this.startedAt = new Date().toISOString();
    if (feed) { this.lifecycleFeed = feed; }
  }

  public recordLifecycleEvent(event: HistoricalMempoolEvent): void {
    this.eventLog.push(event);
    if (this.eventLog.length > TIME_MACHINE_LIMITS.events) {
      this.eventLog.shift();
    }
  }

  private static eventFor(tx: MempoolTransactionExtended | TransactionExtended, type: HistoricalMempoolEvent['event_type'], at: number, blockHeight?: number, replacedBy?: string): HistoricalMempoolEvent {
    const vsize = tx.vsize ?? Math.ceil((tx.weight ?? 0) / 4);
    return {
      event_id: crypto.createHash('sha256').update(`${tx.txid}:${type}:${blockHeight ?? ''}:${replacedBy ?? ''}`).digest('hex').slice(0, 32),
      txid: tx.txid, timestamp_utc: new Date(at).toISOString(), event_type: type, vsize, fee_sats: tx.fee ?? 0,
      fee_rate: vsize > 0 ? Math.round(((tx.fee ?? 0) / vsize) * 100) / 100 : 0, block_height: blockHeight, replaced_by_txid: replacedBy,
    };
  }

  /** Called from the mempool change callback with what entered and left. */
  public observeMempoolChange(added: MempoolTransactionExtended[], removed: MempoolTransactionExtended[], now = Date.now()): void {
    for (const tx of added) { this.recordLifecycleEvent(TimeMachineService.eventFor(tx, 'accepted', now)); }
    for (const tx of removed) { this.recordLifecycleEvent(TimeMachineService.eventFor(tx, 'removed', now)); }
  }

  public observeReplacement(replaced: MempoolTransactionExtended, replacementTxid: string, now = Date.now()): void {
    this.recordLifecycleEvent(TimeMachineService.eventFor(replaced, 'replaced', now, undefined, replacementTxid));
  }

  /** Called from the block hub: records confirmations and snapshots the mempool. */
  public observeBlock(block: BlockExtended, transactions: TransactionExtended[], now = Date.now()): MempoolCheckpoint {
    for (const tx of transactions) { this.recordLifecycleEvent(TimeMachineService.eventFor(tx, 'confirmed', now, block.height)); }
    const snapshot = Object.values(this.lifecycleFeed());
    const rates = snapshot.map(tx => tx.vsize > 0 ? tx.fee / tx.vsize : 0).sort((a, b) => a - b);
    const distribution = BUCKETS.map(bucket => ({ feerate_bucket: bucket.label, count: 0, total_vsize: 0 }));
    let vsize = 0;
    let weight = 0;
    let fees = 0;
    for (const tx of snapshot) {
      const rate = tx.vsize > 0 ? tx.fee / tx.vsize : 0;
      const bucket = distribution[BUCKETS.findIndex(entry => rate >= entry.min && rate < entry.max || (entry.max === Infinity && rate >= entry.min))] ?? distribution[0];
      bucket.count += 1;
      bucket.total_vsize += tx.vsize;
      vsize += tx.vsize;
      weight += tx.weight;
      fees += tx.fee;
    }
    const checkpoint: MempoolCheckpoint = {
      checkpoint_id: `chk-${config.MEMPOOL.NETWORK}-${block.height}-${block.id.slice(0, 12)}`, network: config.MEMPOOL.NETWORK,
      block_height: block.height, block_hash: block.id, timestamp_utc: new Date(block.timestamp * 1000).toISOString(),
      mempool_tx_count: snapshot.length, mempool_vsize: vsize, mempool_weight: weight, mempool_fees_sats: fees,
      median_feerate_sats_vb: rates.length ? Math.round(rates[Math.floor(rates.length / 2)] * 100) / 100 : 0, fee_distribution: distribution,
      block_tx_count: transactions.length, block_weight: block.weight, block_fees_sats: block.extras?.totalFees ?? 0,
      state_hash: crypto.createHash('sha256').update(`${block.id}:${snapshot.map(tx => tx.txid).sort().join(',')}`).digest('hex'),
    };
    this.checkpoints = this.checkpoints.filter(existing => existing.block_height < block.height);
    this.checkpoints.push(checkpoint);
    if (this.checkpoints.length > TIME_MACHINE_LIMITS.checkpoints) { this.checkpoints.shift(); }
    this.stateCache.set(checkpoint.state_hash, { summary: this.summarize(checkpoint, checkpoint.timestamp_utc, checkpoint.block_height, 0), txids: new Set(snapshot.map(tx => tx.txid)) });
    return checkpoint;
  }

  public getCoverage(): {
    network: string;
    observing_since_utc: string;
    earliest_recorded_event_utc: string | null;
    latest_recorded_event_utc: string | null;
    total_events: number;
    total_checkpoints: number;
    earliest_checkpoint_height: number | null;
    latest_checkpoint_height: number | null;
    coverage_gaps: Array<{ start_utc: string; end_utc: string; reason: string }>;
  } {
    return {
      network: config.MEMPOOL.NETWORK,
      observing_since_utc: this.startedAt,
      earliest_recorded_event_utc: this.eventLog[0]?.timestamp_utc ?? null,
      latest_recorded_event_utc: this.eventLog[this.eventLog.length - 1]?.timestamp_utc ?? null,
      total_events: this.eventLog.length,
      total_checkpoints: this.checkpoints.length,
      earliest_checkpoint_height: this.checkpoints[0]?.block_height ?? null,
      latest_checkpoint_height: this.checkpoints[this.checkpoints.length - 1]?.block_height ?? null,
      // History before this process started is not held anywhere; that is the one gap, and it is stated.
      coverage_gaps: [{ start_utc: '1970-01-01T00:00:00.000Z', end_utc: this.startedAt, reason: 'No history is retained before this backend started observing.' }],
    };
  }

  private summarize(checkpoint: MempoolCheckpoint, targetTimestamp: string, targetHeight: number, appliedEvents: number): ReplayStateSummary {
    return {
      state_hash: checkpoint.state_hash, target_timestamp_utc: targetTimestamp, target_block_height: targetHeight,
      nearest_checkpoint_id: checkpoint.checkpoint_id, checkpoint_block_hash: checkpoint.block_hash, applied_events_count: appliedEvents,
      total_transactions: checkpoint.mempool_tx_count, total_vsize: checkpoint.mempool_vsize, total_weight: checkpoint.mempool_weight,
      total_fees_sats: checkpoint.mempool_fees_sats, median_feerate_sats_vb: checkpoint.median_feerate_sats_vb, fee_distribution: checkpoint.fee_distribution,
      projected_blocks_count: Math.ceil(checkpoint.mempool_weight / 4_000_000), coverage_status: appliedEvents === 0 ? 'complete' : 'partial', gap_intervals: [],
    };
  }

  /**
   * The state at the nearest checkpoint at or before the target. Events
   * observed between that checkpoint and the target are counted, not
   * applied: the snapshot is exact at the checkpoint and the count tells
   * the reader how far the target is from it.
   */
  public replayToTimestampOrHeight(targetTimestampUtc?: string, targetBlockHeight?: number): ReplayStateSummary {
    if (this.checkpoints.length === 0) {
      throw new TimeMachineUnavailableError('no-observed-checkpoints', 'No mempool checkpoint has been observed by this backend yet.');
    }
    let nearest: MempoolCheckpoint | null = null;
    if (targetBlockHeight !== undefined && Number.isFinite(targetBlockHeight)) {
      for (const checkpoint of this.checkpoints) { if (checkpoint.block_height <= targetBlockHeight) { nearest = checkpoint; } }
    } else if (targetTimestampUtc) {
      const target = Date.parse(targetTimestampUtc);
      if (!Number.isFinite(target)) { throw new TimeMachineUnavailableError('invalid-target', 'timestamp_utc must be an ISO-8601 date.', 400); }
      for (const checkpoint of this.checkpoints) { if (Date.parse(checkpoint.timestamp_utc) <= target) { nearest = checkpoint; } }
    } else {
      nearest = this.checkpoints[this.checkpoints.length - 1];
    }
    if (!nearest) {
      throw new TimeMachineUnavailableError('target-before-coverage', `The target is before the earliest observed checkpoint (height ${this.checkpoints[0].block_height}).`, 404);
    }
    const targetTime = targetTimestampUtc && !targetBlockHeight ? Date.parse(targetTimestampUtc) : Date.parse(nearest.timestamp_utc);
    const applied = this.eventLog.filter(event => { const at = Date.parse(event.timestamp_utc); return at > Date.parse(nearest!.timestamp_utc) && at <= targetTime; }).length;
    return this.summarize(nearest, new Date(targetTime).toISOString(), targetBlockHeight ?? nearest.block_height, applied);
  }

  public getStateByHash(stateHash: string): ReplayStateSummary | null {
    return this.stateCache.get(stateHash)?.summary ?? null;
  }

  /** Events this backend observed for the txid; empty when it saw none. */
  public getTransactionLifecycle(txid: string): HistoricalMempoolEvent[] {
    return this.eventLog.filter(event => event.txid === txid).slice(-TIME_MACHINE_LIMITS.eventsPerTx);
  }

  public compareStates(stateHashA: string, stateHashB: string): ReplayComparisonReport | null {
    const a = this.stateCache.get(stateHashA);
    const b = this.stateCache.get(stateHashB);
    if (!a || !b) { return null; }
    return {
      state_a: a.summary, state_b: b.summary,
      delta: {
        tx_count_delta: b.summary.total_transactions - a.summary.total_transactions,
        weight_delta: b.summary.total_weight - a.summary.total_weight,
        fees_delta_sats: b.summary.total_fees_sats - a.summary.total_fees_sats,
        median_feerate_delta: Number((b.summary.median_feerate_sats_vb - a.summary.median_feerate_sats_vb).toFixed(2)),
        added_txids: [...b.txids].filter(txid => !a.txids.has(txid)).slice(0, 1000),
        removed_txids: [...a.txids].filter(txid => !b.txids.has(txid)).slice(0, 1000),
      },
    };
  }

  /** The state and its transaction set, produced now. There is no export queue. */
  public exportState(stateHash: string): { state: ReplayStateSummary; txids: string[] } | null {
    const entry = this.stateCache.get(stateHash);
    return entry ? { state: entry.summary, txids: [...entry.txids].sort() } : null;
  }
}

export const timeMachineService = TimeMachineService.getInstance();
