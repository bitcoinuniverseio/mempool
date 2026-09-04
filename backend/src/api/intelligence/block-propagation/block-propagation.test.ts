import blockPropagationService from './block-propagation.service';

describe('BlockPropagationService', () => {
  it('should return overview with sensors and recent blocks', () => {
    const overview = blockPropagationService.getOverview();
    expect(overview.active_sensors_count).toBeGreaterThanOrEqual(3);
    expect(overview.recent_blocks.length).toBeGreaterThan(0);
    expect(overview.reconstruction_success_rate_pct).toBe(100.0);
    expect(overview.recent_fork_races.length).toBeGreaterThanOrEqual(1);
  });

  it('should list sensors across distinct geographic regions', () => {
    const res = blockPropagationService.listSensors();
    expect(res.sensors.length).toBeGreaterThanOrEqual(3);
    const regions = res.sensors.map((s) => s.region);
    expect(regions).toContain('us-east');
    expect(regions).toContain('eu-central');
    expect(regions).toContain('ap-southeast');
  });

  it('should retrieve block propagation details with stage timestamps', () => {
    const overview = blockPropagationService.getOverview();
    const block = blockPropagationService.getBlock(overview.latest_block_hash);
    expect(block).toBeDefined();
    expect(block?.time_to_50_pct_sensors_ms).toBeGreaterThan(0);
    expect(block?.sensor_observations.length).toBeGreaterThanOrEqual(2);
    expect(block?.sensor_observations[0].stages.reconstruction_complete_ms).toBeGreaterThan(0);
  });

  it('should list compact block reconstruction statistics', () => {
    const res = blockPropagationService.listCompactBlocks();
    expect(res.compact_blocks.length).toBeGreaterThanOrEqual(2);
    const first = res.compact_blocks[0];
    expect(first.bip152_version).toBe(2);
    expect(first.reconstruction_success).toBe(true);
    expect(first.merkle_root_verified).toBe(true);
  });

  it('should track fork races and stale tip evidence without selfish mining claims', () => {
    const res = blockPropagationService.listForkRaces();
    expect(res.fork_races.length).toBeGreaterThanOrEqual(1);
    const race = res.fork_races[0];
    expect(race.divergence_height).toBeGreaterThan(800000);
    expect(race.branches.length).toBe(2);
    expect(race.staletip_negotiated_via_bip434).toBe(true);

    const staleRes = blockPropagationService.listStaleTips();
    expect(staleRes.stale_tips.length).toBeGreaterThanOrEqual(1);
    expect(staleRes.stale_tips[0].bip434_negotiated).toBe(true);
  });

  it('should expose FIBRE delivery efficiency comparison', () => {
    const res = blockPropagationService.listFibre();
    expect(res.fibre_observations.length).toBeGreaterThanOrEqual(1);
    const obs = res.fibre_observations[0];
    expect(obs.time_saved_ms).toBeGreaterThan(0);
    expect(obs.fec_recovery_succeeded).toBe(true);
  });
});
