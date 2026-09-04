import consensusConformanceService from './consensus-conformance.service';

describe('ConsensusConformanceService', () => {
  it('should return overview with implementations, targets, and formal artifacts', () => {
    const overview = consensusConformanceService.getOverview();
    expect(overview.total_implementations_evaluated).toBeGreaterThanOrEqual(3);
    expect(overview.total_consensus_targets).toBeGreaterThanOrEqual(3);
    expect(overview.implementations.length).toBeGreaterThanOrEqual(3);
    expect(overview.formal_artifacts.length).toBeGreaterThanOrEqual(2);
  });

  it('should list consensus targets including critical transaction and block parsers', () => {
    const res = consensusConformanceService.listTargets();
    const targetIds = res.targets.map((t) => t.target_id);
    expect(targetIds).toContain('transaction_parse');
    expect(targetIds).toContain('block_parse');
    expect(targetIds).toContain('script_verify');
  });

  it('should retrieve and replay differential conformance cases', () => {
    const cases = consensusConformanceService.listCases();
    expect(cases.cases.length).toBeGreaterThanOrEqual(2);

    const first = cases.cases[0];
    const retrieved = consensusConformanceService.getCase(first.case_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.mismatch_class).toBeDefined();

    const replayRes = consensusConformanceService.replayCase(first.case_id);
    expect(replayRes.success).toBe(true);
    expect(replayRes.divergence_reproduced).toBe(true);
  });

  it('should list formal specification artifacts and machine-checked theorems', () => {
    const res = consensusConformanceService.listFormalArtifacts();
    expect(res.formal_artifacts.length).toBeGreaterThanOrEqual(2);
    const leanProof = res.formal_artifacts.find((a) => a.project === 'btc-verified');
    expect(leanProof).toBeDefined();
    expect(leanProof?.proof_status).toBe('machine_proved');
  });

  it('should start a deterministic campaign with bounded inputs', () => {
    const campaign = consensusConformanceService.startCampaign('transaction_parse', 42);
    expect(campaign.target_id).toBe('transaction_parse');
    expect(campaign.total_inputs_evaluated).toBeGreaterThan(0);
    expect(campaign.seed).toBe(42);
  });
});
