import { timeMachineService, TimeMachineUnavailableError } from './time-machine.service';
import { BlockExtended, MempoolTransactionExtended, TransactionExtended } from '../../../mempool.interfaces';

/**
 * The feed stands in for the live mempool: the service snapshots whatever
 * it returns when a block arrives. Nothing is seeded; every number below is
 * derived from these fixtures.
 */
const mem = (txid: string, fee: number, vsize: number): MempoolTransactionExtended => ({ txid, fee, vsize, weight: vsize * 4 } as unknown as MempoolTransactionExtended);
const block = (height: number, timestamp: number): BlockExtended => ({ height, id: height.toString(16).padStart(64, '0'), timestamp, weight: 4000, extras: { totalFees: 500 } } as unknown as BlockExtended);
const confirmed = (txid: string): TransactionExtended => ({ txid, fee: 100, vsize: 100, weight: 400 } as unknown as TransactionExtended);

describe('time machine: observed history only', () => {
  let pool: { [txid: string]: MempoolTransactionExtended };
  beforeEach(() => { pool = {}; timeMachineService.resetForTests(() => pool); });

  it('starts empty and says so instead of inventing checkpoints', () => {
    const coverage = timeMachineService.getCoverage();
    expect(coverage.total_events).toBe(0);
    expect(coverage.total_checkpoints).toBe(0);
    expect(coverage.earliest_checkpoint_height).toBeNull();
    expect(coverage.coverage_gaps).toHaveLength(1);
    expect(coverage.coverage_gaps[0].end_utc).toBe(coverage.observing_since_utc);
    expect(() => timeMachineService.replayToTimestampOrHeight(undefined, 860020)).toThrow(TimeMachineUnavailableError);
    expect(timeMachineService.getTransactionLifecycle('a'.repeat(64))).toEqual([]);
    expect(timeMachineService.getStateByHash('x')).toBeNull();
    expect(timeMachineService.compareStates('x', 'y')).toBeNull();
    expect(timeMachineService.exportState('x')).toBeNull();
  });

  it('a checkpoint is the real mempool at the block, with an exact fee distribution', () => {
    pool = { a: mem('a', 100, 100), b: mem('b', 1200, 100), c: mem('c', 6000, 100) };
    const checkpoint = timeMachineService.observeBlock(block(100, 1_000_000), [confirmed('z')]);
    expect(checkpoint).toMatchObject({ block_height: 100, mempool_tx_count: 3, mempool_vsize: 300, mempool_weight: 1200, mempool_fees_sats: 7300, median_feerate_sats_vb: 12, block_tx_count: 1, block_fees_sats: 500 });
    expect(checkpoint.fee_distribution.map(b => [b.feerate_bucket, b.count])).toEqual([['1-5 sat/vB', 1], ['6-10 sat/vB', 0], ['11-20 sat/vB', 1], ['21-50 sat/vB', 0], ['50+ sat/vB', 1]]);
    const state = timeMachineService.getStateByHash(checkpoint.state_hash);
    expect(state).toMatchObject({ total_transactions: 3, coverage_status: 'complete', applied_events_count: 0 });
    expect(timeMachineService.getTransactionLifecycle('z')).toEqual([expect.objectContaining({ event_type: 'confirmed', block_height: 100 })]);
  });

  it('replays to the nearest observed checkpoint and refuses targets before coverage', () => {
    pool = { a: mem('a', 100, 100) };
    const first = timeMachineService.observeBlock(block(100, 1_000_000), []);
    pool = { a: mem('a', 100, 100), b: mem('b', 100, 100) };
    timeMachineService.observeMempoolChange([mem('b', 100, 100)], [], 1_000_300_000);
    const second = timeMachineService.observeBlock(block(101, 1_000_600), []);
    expect(timeMachineService.replayToTimestampOrHeight(undefined, 100).state_hash).toBe(first.state_hash);
    expect(timeMachineService.replayToTimestampOrHeight(undefined, 100_000).state_hash).toBe(second.state_hash);
    const between = timeMachineService.replayToTimestampOrHeight(new Date(1_000_400_000).toISOString());
    expect(between.state_hash).toBe(first.state_hash);
    expect(between.applied_events_count).toBe(1);
    expect(between.coverage_status).toBe('partial');
    expect(() => timeMachineService.replayToTimestampOrHeight(undefined, 99)).toThrow(/before the earliest observed checkpoint/);
    expect(() => timeMachineService.replayToTimestampOrHeight('not a date')).toThrow(/ISO-8601/);
  });

  it('comparison lists the transactions that actually entered and left', () => {
    pool = { a: mem('a', 100, 100), b: mem('b', 100, 100) };
    const first = timeMachineService.observeBlock(block(100, 1_000_000), []);
    pool = { b: mem('b', 100, 100), c: mem('c', 300, 100) };
    const second = timeMachineService.observeBlock(block(101, 1_000_600), []);
    const report = timeMachineService.compareStates(first.state_hash, second.state_hash)!;
    expect(report.delta).toMatchObject({ tx_count_delta: 0, fees_delta_sats: 200, added_txids: ['c'], removed_txids: ['a'] });
    expect(timeMachineService.exportState(second.state_hash)).toEqual({ state: report.state_b, txids: ['b', 'c'] });
  });

  it('lifecycle events are the ones the mempool loop reported, bounded', () => {
    timeMachineService.observeMempoolChange([mem('t', 200, 100)], [], 1_000_000_000);
    timeMachineService.observeReplacement(mem('t', 200, 100), 'r'.repeat(64), 1_000_001_000);
    timeMachineService.observeMempoolChange([], [mem('t', 200, 100)], 1_000_002_000);
    expect(timeMachineService.getTransactionLifecycle('t').map(e => e.event_type)).toEqual(['accepted', 'replaced', 'removed']);
    expect(timeMachineService.getTransactionLifecycle('t')[1].replaced_by_txid).toBe('r'.repeat(64));
    expect(timeMachineService.getCoverage().total_events).toBe(3);
  });
});
