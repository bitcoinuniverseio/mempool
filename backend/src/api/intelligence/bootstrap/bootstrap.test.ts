import bootstrapService, { BootstrapEvidenceError } from './bootstrap.service';

describe('BootstrapService', () => {
  it('does not invent nodes, chainstates, manifests or verification records', () => {
    for (const read of [
      () => bootstrapService.getOverview(), () => bootstrapService.listNodes(),
      () => bootstrapService.listNodeChainstates(), () => bootstrapService.getNodeChainstates('node-syncing-staging'),
      () => bootstrapService.listSnapshots(), () => bootstrapService.getSnapshot('snap-840000-mainnet'),
      () => bootstrapService.getVerification('unknown'),
    ]) expect(read).toThrow(BootstrapEvidenceError);
  });

  it('requires authority-backed snapshot verification for both advertised request shapes', () => {
    expect(() => bootstrapService.verifySnapshot({ snapshot_id: 'unknown', base_height: 840000,
      file_sha256: 'ab'.repeat(32), expected_txoutset_hash: 'cd'.repeat(32) })).toThrow(/No trusted manifest/);
    expect(() => bootstrapService.verifySnapshot({ height: 840000, sha256: 'ab'.repeat(32), utxo_hash: 'cd'.repeat(32) }))
      .toThrow(/No trusted manifest/);
  });

  it('rejects malformed input before reporting an authority as missing', () => {
    for (const data of [{}, { height: -1, sha256: 'ab'.repeat(32), utxo_hash: 'cd'.repeat(32) },
      { height: 840000, sha256: 'z'.repeat(64), utxo_hash: 'cd'.repeat(32) }]) {
      expect(() => bootstrapService.verifySnapshot(data)).toThrow(expect.objectContaining({ code: 'invalid-input', status: 400 }));
    }
  });

  it('cannot select a seeded snapshot or estimate an unobserved node in a plan', () => {
    expect(() => bootstrapService.createBootstrapPlan({ node_version: '28.0.0', network: 'mainnet', available_disk_gb: 1000 }))
      .toThrow(expect.objectContaining({ code: 'unavailable-node-source' }));
  });

  it.each(['generate_snapshot', 'verify_snapshot', 'load_snapshot'] as const)('cannot fabricate a %s job', job_type => {
    expect(() => bootstrapService.createOperatorJob({ job_type, node_id: 'unknown', snapshot_id: 'unknown' }))
      .toThrow(expect.objectContaining({ code: 'unavailable-operator' }));
    expect(() => bootstrapService.getJob('unknown')).toThrow(/durable operator job store/);
  });
});
