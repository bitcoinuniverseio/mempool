import bootstrapService from './bootstrap.service';

describe('BootstrapService', () => {
  it('should return overview with configured nodes and snapshots', () => {
    const overview = bootstrapService.getOverview();
    expect(overview.total_nodes).toBeGreaterThanOrEqual(2);
    expect(overview.snapshots.length).toBeGreaterThanOrEqual(1);
    expect(overview.active_chainstates.length).toBeGreaterThanOrEqual(1);
  });

  it('should retrieve node chainstate observation with dual-chainstate tracking', () => {
    const obs = bootstrapService.getNodeChainstates('node-syncing-staging');
    expect(obs).toBeDefined();
    expect(obs?.current_phase).toBe('background_validation');
    expect(obs?.active_chainstate.type).toBe('snapshot');
    expect(obs?.background_chainstate).toBeDefined();
    expect(obs?.background_chainstate?.target_height).toBe(840000);
  });

  it('should verify snapshot SHA256 and UTXO hash commitments', () => {
    const valid = bootstrapService.verifySnapshot({
      snapshot_id: 'snap-840000-mainnet',
      file_sha256: '9f82a1c002138914801984019284012984012984019284019284019284019284',
      base_height: 840000,
      expected_txoutset_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    });
    expect(valid.overall_verified).toBe(true);
    expect(valid.sha256_valid).toBe(true);
    expect(valid.expected_metadata_match).toBe(true);

    const mismatch = bootstrapService.verifySnapshot({
      snapshot_id: 'snap-840000-mainnet',
      file_sha256: 'corrupted-sha',
      base_height: 840000,
      expected_txoutset_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    });
    expect(mismatch.overall_verified).toBe(false);
    expect(mismatch.sha256_valid).toBe(false);
  });

  it('should generate bootstrap plans comparing traditional IBD and AssumeUTXO', () => {
    const plan = bootstrapService.createBootstrapPlan({
      node_version: '28.0.0',
      network: 'mainnet',
      available_disk_gb: 1000,
    });
    expect(plan.traditional_ibd.estimated_download_gb).toBeGreaterThan(500);
    expect(plan.assumeutxo.snapshot_download_gb).toBeLessThan(20);
    expect(plan.assumeutxo.requires_background_validation).toBe(true);
    expect(plan.rollback_instructions.length).toBeGreaterThan(0);
  });

  it('should initialize operator jobs for snapshots and loads', () => {
    const job = bootstrapService.createOperatorJob({
      job_type: 'load_snapshot',
      node_id: 'node-syncing-staging',
      snapshot_id: 'snap-840000-mainnet',
    });
    expect(job.status).toBe('running');
    expect(job.job_type).toBe('load_snapshot');

    const retrieved = bootstrapService.getJob(job.job_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.job_id).toBe(job.job_id);
  });
});
