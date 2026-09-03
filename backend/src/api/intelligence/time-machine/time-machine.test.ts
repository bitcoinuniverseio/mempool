import { timeMachineService } from './time-machine.service';

describe('Product 3: Historical Mempool Time Machine', () => {
  it('reports exact coverage boundaries and explicit gap intervals without silent interpolation', () => {
    const coverage = timeMachineService.getCoverage();
    expect(coverage.earliest_recorded_event_utc).toBeDefined();
    expect(coverage.latest_recorded_event_utc).toBeDefined();
    expect(coverage.total_checkpoints).toBeGreaterThan(0);
    expect(coverage.coverage_gaps.length).toBeGreaterThan(0);
    expect(coverage.coverage_gaps[0].reason).toBeDefined();
  });

  it('reconstructs historical mempool state deterministically from block height', () => {
    const state = timeMachineService.replayToTimestampOrHeight(undefined, 860020);
    expect(state.state_hash).toBeDefined();
    expect(state.target_block_height).toBe(860020);
    expect(state.total_transactions).toBeGreaterThan(10000);
    expect(state.total_weight).toBeGreaterThan(0);
    expect(state.total_fees_sats).toBeGreaterThan(0);
    expect(state.fee_distribution.length).toBeGreaterThanOrEqual(4);

    const sameState = timeMachineService.replayToTimestampOrHeight(undefined, 860020);
    expect(sameState.state_hash).toBe(state.state_hash);
  });

  it('retrieves cached historical states by stable state hash', () => {
    const original = timeMachineService.replayToTimestampOrHeight(undefined, 860010);
    const retrieved = timeMachineService.getStateByHash(original.state_hash);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.state_hash).toBe(original.state_hash);
    expect(retrieved?.total_transactions).toBe(original.total_transactions);
  });

  it('compares two historical states and derives deltas', () => {
    const stateA = timeMachineService.replayToTimestampOrHeight(undefined, 860010);
    const stateB = timeMachineService.replayToTimestampOrHeight(undefined, 860030);

    const comparison = timeMachineService.compareStates(stateA.state_hash, stateB.state_hash);
    expect(comparison.delta.tx_count_delta).toBeDefined();
    expect(comparison.delta.weight_delta).toBeDefined();
    expect(comparison.delta.fees_delta_sats).toBeDefined();
    expect(comparison.state_a.state_hash).toBe(stateA.state_hash);
    expect(comparison.state_b.state_hash).toBe(stateB.state_hash);
  });

  it('provides chronological transaction lifecycle playback', () => {
    const txid = 'a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d';
    const lifecycle = timeMachineService.getTransactionLifecycle(txid);
    expect(lifecycle.length).toBeGreaterThanOrEqual(2);
    expect(lifecycle[0].event_type).toBe('observed');
    expect(lifecycle[1].event_type).toBe('accepted');
    expect(Date.parse(lifecycle[1].timestamp_utc)).toBeGreaterThanOrEqual(Date.parse(lifecycle[0].timestamp_utc));
  });

  it('generates export jobs with stable identifiers and formats', () => {
    const state = timeMachineService.replayToTimestampOrHeight(undefined, 860010);
    const exportJob = timeMachineService.startExportJob(state.state_hash, 'parquet');
    expect(exportJob.job_id).toBeDefined();
    expect(exportJob.download_url).toContain('parquet');
  });
});
