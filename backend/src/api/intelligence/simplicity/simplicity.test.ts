import simplicityService from './simplicity.service';

describe('SimplicityService', () => {
  it('should return overview with active programs and occurrences', () => {
    const overview = simplicityService.getOverview();
    expect(overview.total_programs).toBeGreaterThanOrEqual(2);
    expect(overview.active_toolchain).toBeDefined();
    expect(overview.recent_programs.length).toBeGreaterThanOrEqual(2);
  });

  it('should list and retrieve programs by ID and CMR', () => {
    const progs = simplicityService.listPrograms();
    expect(progs.length).toBeGreaterThanOrEqual(2);

    const first = progs[0];
    const retrievedById = simplicityService.getProgram(first.program_id);
    expect(retrievedById).toBeDefined();
    expect(retrievedById?.cmr).toBe(first.cmr);

    const retrievedByCmr = simplicityService.getProgram(first.cmr);
    expect(retrievedByCmr).toBeDefined();
    expect(retrievedByCmr?.program_id).toBe(first.program_id);
  });

  it('should decode program bytes and compute Merkle roots', () => {
    const decoded = simplicityService.decodeProgram('0102030405060708090a0b0c0d0e0f10');
    expect(decoded.success).toBe(true);
    expect(decoded.cmr.length).toBe(64);
    expect(decoded.imr.length).toBe(64);
    expect(decoded.amr.length).toBe(64);
    expect(decoded.jets.length).toBeGreaterThan(0);

    const invalid = simplicityService.decodeProgram('01');
    expect(invalid.success).toBe(false);
    expect(invalid.errors).toContain('Simplicity program bytes too short or empty');
  });

  it('should verify formal proof artifacts and reject unsupported systems', () => {
    const valid = simplicityService.verifyFormalArtifact({
      schema_version: '1.0.0',
      program_cmr: '9b3e18cf9410ea82b405f63901a88b5601235123992019485123491823019283',
      source_hash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      compiler_revision: 'simplicity-hl-0.2.1',
      libSimplicity_revision: 'commit-9f82a1c',
      proof_system: 'coq',
      proof_source_hash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      proof_artifact_hash: 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
      statement: 'Theorem test: eval(prog) = true.',
      dependencies: ['Simplicity.Semantics'],
      verification_command: 'coqc test.v',
    });
    expect(valid.verified).toBe(true);
    expect(valid.proof_state).toBe('proof_checked');

    const invalid = simplicityService.verifyFormalArtifact({
      schema_version: '1.0.0',
      program_cmr: '9b3e18cf9410ea82b405f63901a88b5601235123992019485123491823019283',
      source_hash: 'hash',
      compiler_revision: '0.1',
      libSimplicity_revision: '0.1',
      proof_system: 'custom_prover' as any,
      proof_source_hash: 'hash',
      proof_artifact_hash: 'hash',
      statement: 'statement',
      dependencies: [],
      verification_command: 'exec',
    });
    expect(invalid.verified).toBe(false);
    expect(invalid.proof_state).toBe('proof_failed');
  });

  it('should retrieve toolchains and transaction execution trace', () => {
    const toolchains = simplicityService.listToolchains();
    expect(toolchains.length).toBeGreaterThanOrEqual(1);
    expect(toolchains[0].is_active).toBe(true);

    const tx = simplicityService.getTransaction('3f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a');
    expect(tx.has_simplicity).toBe(true);
    expect(tx.executions.length).toBe(1);
    expect(tx.executions[0].steps.length).toBe(3);
  });
});
