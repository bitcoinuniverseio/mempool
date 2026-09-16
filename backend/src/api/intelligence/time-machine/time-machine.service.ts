import * as crypto from 'crypto';
import { join } from 'path';
import cluster from 'cluster';
import { HistoryStore, historyPathForRole } from './history-store';
import { validateHistorySnapshot, validUtc } from './history-validation';
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
  sequence?: number;
  event_id: string;
  txid: string;
  timestamp_utc: string;
  event_type: 'observed' | 'accepted' | 'removed' | 'confirmed' | 'replaced' | 'conflicted' | 'evicted' | 'reaccepted_after_reorg';
  vsize: number;
  weight?: number;
  fee_sats: number;
  fee_rate: number;
  block_height?: number;
  replaced_by_txid?: string;
}

export interface MempoolCheckpoint {
  event_sequence?: number;
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
  private stateCache: Map<string, { summary: ReplayStateSummary; txids: Set<string>; transactions: Map<string, { vsize: number; weight: number; fee: number }> }> = new Map();
  private evictedThrough = 0;
  private evictedSequence = 0;
  private observedThrough = 0;
  private interruptedObservation = false;
  private gaps: Array<{ start_utc: string; end_utc: string; reason: string }> = [];
  private readonly network: string;
  private store: HistoryStore | null;
  private storageError: string | null = null;
  private loadFailed = false;
  private dirty = false;
  private timer?: NodeJS.Timeout;
  private writing: Promise<void> | null = null;
  private eventSequence = 0;
  private startedAt = new Date().toISOString();
  private lifecycleFeed: () => { [txid: string]: MempoolTransactionExtended } = () => mempool.getMempool();

  public constructor(options: { store?: HistoryStore | null; network?: string; now?: number; feed?: () => { [txid: string]: MempoolTransactionExtended } } = {}) {
    this.network = options.network ?? config.MEMPOOL.NETWORK;
    const now = options.now ?? Date.now();
    this.startedAt = new Date(now).toISOString();
    const basePath = process.env.UNIVERSE_TIME_MACHINE_HISTORY_PATH || join(config.MEMPOOL.CACHE_DIR, 'time-machine-' + this.network + '.json.gz');
    const historyPath = historyPathForRole(basePath, !!config.MEMPOOL.SPAWN_CLUSTER_PROCS, cluster.isPrimary, process.env.workerId);
    this.store = options.store === undefined ? (historyPath ? new HistoryStore(historyPath, this.network) : null) : options.store;
    if (options.feed) this.lifecycleFeed = options.feed;

    try {
      const stored = this.store?.read();
      if (stored) {
        const value = validateHistorySnapshot(stored, this.network, TIME_MACHINE_LIMITS);
        this.startedAt = value.startedAt;
        this.eventLog = value.events;
        this.eventSequence = value.eventSequence;
        this.evictedSequence = value.evictedSequence;
        this.evictedThrough = value.evictedThrough;
        this.observedThrough = value.observedThrough;
        this.gaps = value.gaps;
        this.checkpoints = value.checkpoints.map(entry => entry.checkpoint);
        for (const entry of value.checkpoints) {
          const transactions = new Map(entry.transactions);
          this.stateCache.set(entry.checkpoint.state_hash, { summary: this.summarize(entry.checkpoint, entry.checkpoint.timestamp_utc, entry.checkpoint.block_height, 0), txids: new Set(transactions.keys()), transactions });
        }
        if (now > this.observedThrough) this.gaps.push({ start_utc: new Date(this.observedThrough).toISOString(), end_utc: new Date(now).toISOString(), reason: 'Backend was not observing continuously across a restart.' });
        if (this.gaps.length > 1024) {
          const cutoff = Date.parse(this.gaps[this.gaps.length - 1024].end_utc);
          this.gaps = this.gaps.slice(-1024);
          this.checkpoints = this.checkpoints.filter(checkpoint => Date.parse(checkpoint.timestamp_utc) > cutoff);
          const retained = new Set(this.checkpoints.map(checkpoint => checkpoint.state_hash));
          for (const hash of this.stateCache.keys()) if (!retained.has(hash)) this.stateCache.delete(hash);
        }
      }
    } catch {
      this.storageError = 'History storage is locked by another writer or failed schema, network or integrity validation; it was preserved and will not be overwritten.';
      this.loadFailed = true;
    }
  }

  private schedulePersistence(): void {
    if (!this.store || this.loadFailed) return;
    this.dirty = true;
    if (this.timer || this.writing) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flushHistory().catch(() => undefined); }, 250);
    this.timer.unref();
  }

  /** Drain coalesced writes serially. Tests and graceful shutdown can await durability. */
  public flushHistory(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.loadFailed) return Promise.reject(new TimeMachineUnavailableError('history-storage-invalid', this.storageError!));
    if (this.writing) return this.writing;
    this.writing = (async () => {
      while (this.dirty && this.store) {
        this.dirty = false;
        try {
          await this.store.write({ schema: 'observed-history-v1', network: this.network, startedAt: this.startedAt,
            eventSequence: this.eventSequence, evictedSequence: this.evictedSequence, evictedThrough: this.evictedThrough,
            observedThrough: this.observedThrough, gaps: this.gaps, events: this.eventLog,
            checkpoints: this.checkpoints.map(checkpoint => ({ checkpoint, transactions: [...this.stateCache.get(checkpoint.state_hash)!.transactions] })) });
          this.storageError = null;
        } catch {
          this.dirty = true;
          this.storageError = 'History could not be persisted; recent observations may not survive a restart.';
          throw new TimeMachineUnavailableError('history-storage-write-failed', this.storageError);
        }
      }
    })().finally(() => { this.writing = null; });
    return this.writing;
  }

  public async closeHistory(): Promise<void> {
    try { await this.flushHistory(); } finally { const store = this.store; this.store = null; store?.close(); }
  }

  public static getInstance(): TimeMachineService {
    if (!TimeMachineService.instance) {
      TimeMachineService.instance = new TimeMachineService();
    }
    return TimeMachineService.instance;
  }

  /** Test seam: an alternative mempool reader and a clean slate. */
  public resetForTests(feed?: () => { [txid: string]: MempoolTransactionExtended }): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined; this.store = null; this.dirty = false; this.storageError = null; this.loadFailed = false;
    this.evictedSequence = 0; this.observedThrough = 0; this.gaps = []; this.interruptedObservation = false;
    this.eventLog = [];
    this.checkpoints = [];
    this.stateCache.clear();
    this.evictedThrough = 0;
    this.eventSequence = 0;
    this.startedAt = new Date().toISOString();
    if (feed) { this.lifecycleFeed = feed; }
  }

  public recordLifecycleEvent(event: HistoricalMempoolEvent): void {
    const at = Date.parse(event.timestamp_utc);
    if (!Number.isFinite(at) || at < this.observedThrough) throw new TimeMachineUnavailableError('invalid-observation', 'Lifecycle timestamps must be valid and nondecreasing.', 400);
    this.observedThrough = at;
    this.eventLog.push({ ...event, sequence: ++this.eventSequence });
    if (this.eventLog.length > TIME_MACHINE_LIMITS.events) {
      const removed = this.eventLog.shift();
      if (removed) { this.evictedThrough = Math.max(this.evictedThrough, Date.parse(removed.timestamp_utc)); this.evictedSequence = removed.sequence!; }
    }
    this.schedulePersistence();
  }

  private static eventFor(tx: MempoolTransactionExtended | TransactionExtended, type: HistoricalMempoolEvent['event_type'], at: number, blockHeight?: number, replacedBy?: string): HistoricalMempoolEvent {
    const vsize = tx.vsize ?? Math.ceil((tx.weight ?? 0) / 4);
    return {
      event_id: crypto.createHash('sha256').update(`${tx.txid}:${type}:${blockHeight ?? ''}:${replacedBy ?? ''}`).digest('hex').slice(0, 32),
      txid: tx.txid, timestamp_utc: new Date(at).toISOString(), event_type: type, vsize, weight: tx.weight, fee_sats: tx.fee ?? 0,
      fee_rate: vsize > 0 ? Math.round(((tx.fee ?? 0) / vsize) * 100) / 100 : 0, block_height: blockHeight, replaced_by_txid: replacedBy,
    };
  }

  /** Called from the mempool change callback with what entered and left. */
  public observeMempoolChange(added: MempoolTransactionExtended[], removed: MempoolTransactionExtended[], now = Date.now()): void {
    if (!Number.isSafeInteger(now) || now < this.observedThrough) throw new TimeMachineUnavailableError('invalid-observation', 'Observation time must be nondecreasing.', 400);
    for (const tx of added) { this.recordLifecycleEvent(TimeMachineService.eventFor(tx, 'accepted', now)); }
    for (const tx of removed) { this.recordLifecycleEvent(TimeMachineService.eventFor(tx, 'removed', now)); }
    this.observedThrough = Math.max(this.observedThrough, now);
    this.schedulePersistence();
  }

  /** Complete polls advance observed coverage even when their transaction delta is empty. */
  public observePoll(added: MempoolTransactionExtended[], removed: MempoolTransactionExtended[], complete: boolean, now = Date.now()): void {
    if (!complete) this.markObservationFailure(now);
    else if (this.interruptedObservation) {
      this.gaps[this.gaps.length - 1].end_utc = new Date(now).toISOString();
      this.interruptedObservation = false;
    }
    this.observeMempoolChange(added, removed, now);
  }

  /** Called by the main loop when a poll fails; recovery closes the unknown interval. */
  public markObservationFailure(now = Date.now()): void {
    if (!Number.isSafeInteger(now) || now < this.observedThrough) return;
    if (this.interruptedObservation) this.gaps[this.gaps.length - 1].end_utc = new Date(now).toISOString();
    else this.gaps.push({ start_utc: new Date(this.observedThrough || now).toISOString(), end_utc: new Date(now).toISOString(), reason: 'Mempool polling failed or returned an incomplete snapshot.' });
    this.interruptedObservation = true;
    if (this.gaps.length > 1024) {
      this.checkpoints = []; this.stateCache.clear(); this.gaps = this.gaps.slice(-1024);
    }
    this.schedulePersistence();
  }
  public observeReplacement(replaced: MempoolTransactionExtended, replacementTxid: string, now = Date.now()): void {
    this.recordLifecycleEvent(TimeMachineService.eventFor(replaced, 'replaced', now, undefined, replacementTxid));
  }

  /** Called from the block hub: records confirmations and snapshots the mempool. */
  public observeBlock(block: BlockExtended, transactions: TransactionExtended[], now = Date.now()): MempoolCheckpoint {
    if (!Number.isSafeInteger(now) || now < this.observedThrough) throw new TimeMachineUnavailableError('invalid-observation', 'Observation time must be nondecreasing.', 400);
    for (const tx of transactions) { this.recordLifecycleEvent(TimeMachineService.eventFor(tx, 'confirmed', now, block.height)); }
    this.observedThrough = Math.max(this.observedThrough, now);
    const confirmed = new Set(transactions.map(tx => tx.txid));
    const snapshot = Object.values(this.lifecycleFeed()).filter(tx => !confirmed.has(tx.txid));
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
      event_sequence: this.eventSequence,
      checkpoint_id: `chk-${this.network}-${block.height}-${block.id.slice(0, 12)}`, network: this.network,
      block_height: block.height, block_hash: block.id, timestamp_utc: new Date(now).toISOString(),
      mempool_tx_count: snapshot.length, mempool_vsize: vsize, mempool_weight: weight, mempool_fees_sats: fees,
      median_feerate_sats_vb: rates.length ? Math.round(rates[Math.floor(rates.length / 2)] * 100) / 100 : 0, fee_distribution: distribution,
      block_tx_count: transactions.length, block_weight: block.weight, block_fees_sats: block.extras?.totalFees ?? 0,
      state_hash: crypto.createHash('sha256').update(`${block.id}:${snapshot.map(tx => tx.txid).sort().join(',')}`).digest('hex'),
    };
    this.checkpoints = this.checkpoints.filter(existing => existing.block_height < block.height);
    this.checkpoints.push(checkpoint);
    if (this.checkpoints.length > TIME_MACHINE_LIMITS.checkpoints) { this.checkpoints.shift(); }
    this.stateCache.set(checkpoint.state_hash, { summary: this.summarize(checkpoint, checkpoint.timestamp_utc, checkpoint.block_height, 0),
      txids: new Set(snapshot.map(tx => tx.txid)), transactions: new Map(snapshot.map(tx => [tx.txid, { vsize: tx.vsize, weight: tx.weight, fee: tx.fee }])) });
    const retained = new Set(this.checkpoints.map(item => item.state_hash));
    for (const hash of this.stateCache.keys()) if (!retained.has(hash)) this.stateCache.delete(hash);
    this.schedulePersistence();
    return checkpoint;
  }

  public getCoverage(): {
    network: string;
    observer_id: string;
    observing_since_utc: string;
    earliest_recorded_event_utc: string | null;
    latest_recorded_event_utc: string | null;
    persistence: { enabled: boolean; pending: boolean; error: string | null };
    observed_through_utc: string | null;
    total_events: number;
    total_checkpoints: number;
    earliest_checkpoint_height: number | null;
    latest_checkpoint_height: number | null;
    coverage_gaps: Array<{ start_utc: string; end_utc: string; reason: string }>;
  } {
    return {
      network: this.network,
      observer_id: config.MEMPOOL.SPAWN_CLUSTER_PROCS ? 'worker-' + process.env.workerId : 'single-process',
      observing_since_utc: this.startedAt,
      earliest_recorded_event_utc: this.eventLog[0]?.timestamp_utc ?? null,
      latest_recorded_event_utc: this.eventLog[this.eventLog.length - 1]?.timestamp_utc ?? null,
      persistence: { enabled: !!this.store, pending: this.dirty || !!this.writing, error: this.storageError },
      observed_through_utc: this.observedThrough ? new Date(this.observedThrough).toISOString() : null,
      total_events: this.eventLog.length,
      total_checkpoints: this.checkpoints.length,
      earliest_checkpoint_height: this.checkpoints[0]?.block_height ?? null,
      latest_checkpoint_height: this.checkpoints[this.checkpoints.length - 1]?.block_height ?? null,
      // History before this process started is not held anywhere; that is the one gap, and it is stated.
      coverage_gaps: [{ start_utc: '1970-01-01T00:00:00.000Z', end_utc: this.startedAt, reason: 'No history is retained before this backend started observing.' }, ...this.gaps],
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
   * Reconstruct the observed mempool from a retained checkpoint and the
   * subsequent lifecycle events. Never substitute old checkpoint totals.
   */
  public replayToTimestampOrHeight(targetTimestampUtc?: string, targetBlockHeight?: number): ReplayStateSummary {
    if (targetTimestampUtc !== undefined && targetBlockHeight !== undefined) throw new TimeMachineUnavailableError('invalid-target', 'Supply either timestamp_utc or block_height, not both.', 400);
    if (targetBlockHeight !== undefined && (!Number.isSafeInteger(targetBlockHeight) || targetBlockHeight < 0)) throw new TimeMachineUnavailableError('invalid-target', 'block_height must be a nonnegative integer.', 400);
    if (targetTimestampUtc !== undefined && !validUtc(targetTimestampUtc)) throw new TimeMachineUnavailableError('invalid-target', 'timestamp_utc must be a UTC ISO-8601 date.', 400);
    if (this.checkpoints.length === 0) {
      throw new TimeMachineUnavailableError('no-observed-checkpoints', 'No mempool checkpoint has been observed by this backend yet.');
    }
    let nearest: MempoolCheckpoint | null = null;
    if (targetBlockHeight !== undefined && Number.isFinite(targetBlockHeight)) {
      if (!Number.isSafeInteger(targetBlockHeight) || targetBlockHeight < 0) throw new TimeMachineUnavailableError('invalid-target', 'block_height must be a nonnegative integer.', 400);
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
    if (targetBlockHeight !== undefined && targetBlockHeight !== nearest.block_height) {
      throw new TimeMachineUnavailableError('target-outside-coverage', 'No retained checkpoint exists for the requested block height.', 404);
    }
    const targetTime = targetTimestampUtc && targetBlockHeight === undefined ? Date.parse(targetTimestampUtc) : Date.parse(nearest.timestamp_utc);
    const checkpointTime = Date.parse(nearest.timestamp_utc);
    if (targetTime > Date.now()) throw new TimeMachineUnavailableError('target-outside-coverage', 'Future mempool state has not been observed.', 404);
    if (targetBlockHeight === undefined && this.evictedSequence > (nearest.event_sequence ?? 0)) {
      throw new TimeMachineUnavailableError('event-history-pruned', 'Events required to replay this checkpoint have been pruned.', 404);
    }
    const gaps = this.gaps.filter(gap => Date.parse(gap.end_utc) > checkpointTime && Date.parse(gap.start_utc) < targetTime);
    if (gaps.length) throw new TimeMachineUnavailableError('observation-gap', 'Replay crosses an interval when the backend was not observing; select a checkpoint after the gap.', 404);
    const cached = this.stateCache.get(nearest.state_hash);
    if (!cached) throw new TimeMachineUnavailableError('checkpoint-state-missing', 'The retained checkpoint state is unavailable.');
    const events = this.eventLog.filter(event => { const at = Date.parse(event.timestamp_utc); return targetBlockHeight === undefined && (event.sequence ?? 0) > (nearest!.event_sequence ?? 0) && at <= targetTime; });
    const markCoverage = (summary: ReplayStateSummary): ReplayStateSummary => {
      if (targetTime > this.observedThrough) {
        summary.coverage_status = 'partial';
        summary.gap_intervals = [{ start_utc: new Date(this.observedThrough).toISOString(), end_utc: new Date(targetTime).toISOString(), reason: 'No successful observation was recorded through the requested time.' }];
      }
      return summary;
    };
    if (!events.length) return markCoverage(this.summarize(nearest, new Date(targetTime).toISOString(), nearest.block_height, 0));
    const transactions = new Map(cached.transactions);
    for (const event of events) {
      if (['observed', 'accepted', 'reaccepted_after_reorg'].includes(event.event_type)) {
        if (!Number.isSafeInteger(event.weight) || event.weight! < 0) throw new TimeMachineUnavailableError('event-state-incomplete', 'An accepted transaction event has no exact weight.');
        transactions.set(event.txid, { vsize: event.vsize, weight: event.weight!, fee: event.fee_sats });
      } else {
        transactions.delete(event.txid);
      }
    }
    const entries = [...transactions.values()];
    const rates = entries.map(tx => tx.vsize > 0 ? tx.fee / tx.vsize : 0).sort((a, b) => a - b);
    const distribution = BUCKETS.map(bucket => ({ feerate_bucket: bucket.label, count: 0, total_vsize: 0 }));
    for (const tx of entries) {
      const rate = tx.vsize > 0 ? tx.fee / tx.vsize : 0;
      const bucket = distribution[BUCKETS.findIndex(item => rate >= item.min && rate < item.max)] ?? distribution[0];
      bucket.count++; bucket.total_vsize += tx.vsize;
    }
    const summary = this.summarize(nearest, new Date(targetTime).toISOString(), nearest.block_height, events.length);
    summary.total_transactions = entries.length;
    summary.total_vsize = entries.reduce((sum, tx) => sum + tx.vsize, 0);
    summary.total_weight = entries.reduce((sum, tx) => sum + tx.weight, 0);
    summary.total_fees_sats = entries.reduce((sum, tx) => sum + tx.fee, 0);
    summary.median_feerate_sats_vb = rates.length ? Math.round(rates[Math.floor(rates.length / 2)] * 100) / 100 : 0;
    summary.fee_distribution = distribution;
    summary.projected_blocks_count = Math.ceil(summary.total_weight / 4_000_000);
    summary.coverage_status = 'complete';
    summary.state_hash = crypto.createHash('sha256').update(`${nearest.block_hash}:${[...transactions.keys()].sort().join(',')}`).digest('hex');
    // Replayed states share the existing bounded state cache and are exported
    // through the same API as observed checkpoints.
    this.stateCache.set(summary.state_hash, { summary, txids: new Set(transactions.keys()), transactions });
    const checkpointHashes = new Set(this.checkpoints.map(item => item.state_hash));
    while (this.stateCache.size > TIME_MACHINE_LIMITS.checkpoints * 2) {
      const evict = [...this.stateCache.keys()].find(hash => !checkpointHashes.has(hash));
      if (!evict) break;
      this.stateCache.delete(evict);
    }
    return markCoverage(summary);
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
