import { quantumService } from './quantum.service';

describe('QuantumService', () => {
  it('should return overview with total supply and exposed percentage', () => {
    const overview = quantumService.getOverview();
    expect(overview).toBeDefined();
    expect(overview.total_supply_sats).toBeGreaterThan(0);
    expect(overview.exposed_supply_percentage).toBeGreaterThan(0);
    expect(overview.cohorts.length).toBeGreaterThan(0);
  });

  it('should audit known outpoint for direct pubkey exposure', () => {
    const knownOutpoint = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b:0';
    const audit = quantumService.auditAddressOrOutpoint(knownOutpoint);
    expect(audit).toBeDefined();
    expect(audit.is_exposed).toBe(true);
    expect(audit.script_type).toBe('p2pk');
  });

  it('should audit Taproot address as keypath exposed', () => {
    const trAddr = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
    const audit = quantumService.auditAddressOrOutpoint(trAddr);
    expect(audit.is_exposed).toBe(true);
    expect(audit.exposure_reason).toBe('keypath_taproot');
  });

  it('should generate noncustodial migration plan', () => {
    const plan = quantumService.generateMigrationPlan({
      exposed_outpoints: ['4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b:0'],
      target_standard: 'p2wpkh',
    });
    expect(plan.plan_id).toBeDefined();
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.post_migration_exposure_percentage).toBe(0.0);
  });
});
