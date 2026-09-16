import { describe, expect, it, vi } from 'vitest';
import { Subject, of } from 'rxjs';
import { QuantumAuditComponent } from './quantum-audit.component';
import { QuantumMigrationComponent } from './quantum-migration.component';
import { publicIdentifier, publicOutpoint, validExposure, validPlan } from './quantum-validation';

const cd = { markForCheck: vi.fn() } as never;
const outpoint = 'ab'.repeat(32) + ':0';
const plan = { plan_id: 'source-plan', total_exposed_sats: 123, recommended_transactions_count: 1,
  estimated_migration_fee_sats: 1, post_migration_exposure_percentage: 42,
  steps: [{ step_number: 1, action: 'Review', description: 'Review source estimate' }] };
const exposure = { outpoint, txid: 'ab'.repeat(32), vout: 0, amount_sats: 123,
  script_type: 'p2tr', is_exposed: true, exposure_reason: 'keypath_taproot' } as const;

describe('quantum public-input and source-evidence boundaries', () => {
  it('rejects secret-like text, malformed outpoints and wrong-network addresses locally', () => {
    const api = { auditIdentifier$: vi.fn(), network: '' };
    const page = new QuantumAuditComponent(api as never, cd);
    for (const input of ['abandon '.repeat(12), 'K' + 'a'.repeat(51), 'ab'.repeat(32) + ':4294967296']) {
      page.identifier = input; page.audit(); expect(page.errorMessage).toContain('Nothing was sent');
    }
    expect(api.auditIdentifier$).not.toHaveBeenCalled();
    expect(publicIdentifier('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', '')).toBe(true);
    expect(publicIdentifier('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'signet')).toBe(false);
    expect(publicOutpoint('ab'.repeat(32) + ':00')).toBe(false);
  });

  it('retains a nonzero projection and rejects missing or invalid percentages', () => {
    const page = new QuantumMigrationComponent({ generateMigrationPlan$: () => of(plan) } as never, cd);
    page.rawOutpoints = outpoint; page.generatePlan();
    expect(page.result?.post_migration_exposure_percentage).toBe(42);
    expect(validPlan({ ...plan, post_migration_exposure_percentage: undefined } as never)).toBe(false);
    expect(validPlan({ ...plan, post_migration_exposure_percentage: 101 })).toBe(false);
  });

  it('rejects duplicate and non-public migration inputs before POST', () => {
    const api = { generateMigrationPlan$: vi.fn() };
    const page = new QuantumMigrationComponent(api as never, cd);
    for (const input of [outpoint + '\n' + outpoint, 'private recovery phrase', '']) {
      page.rawOutpoints = input; page.generatePlan(); expect(page.result).toBeNull();
    }
    expect(api.generateMigrationPlan$).not.toHaveBeenCalled();
  });

  it('cancels pending audit on sample, edit, network change and destroy', () => {
    const response = new Subject<any>(); const networkChanged$ = new Subject<string>();
    const page = new QuantumAuditComponent({ auditIdentifier$: () => response, networkChanged$ } as never, cd);
    for (const clear of [() => page.loadDemoIdentifier(), () => page.clear(), () => networkChanged$.next('signet'), () => page.ngOnDestroy()]) {
      page.identifier = outpoint; page.audit(); expect(response.observed).toBe(true);
      clear(); expect(response.observed).toBe(false); response.next(exposure);
      expect(page.result).toBeNull(); expect(page.auditing).toBe(false);
    }
  });

  it('cancels pending plan on sample/edit and ignores late source response', () => {
    const response = new Subject<any>();
    const page = new QuantumMigrationComponent({ generateMigrationPlan$: () => response } as never, cd);
    page.rawOutpoints = outpoint; page.generatePlan(); page.loadDemoOutpoints();
    response.next(plan); expect(page.result).toBeNull(); expect(response.observed).toBe(false);
    page.generatePlan(); page.clear(); expect(response.observed).toBe(false); page.ngOnDestroy();
  });

  it('rejects absent boolean verdicts and outpoint mismatches instead of declaring protection', () => {
    expect(validExposure(exposure, outpoint)).toBe(true);
    expect(validExposure({ ...exposure, is_exposed: undefined } as never, outpoint)).toBe(false);
    expect(validExposure({ ...exposure, is_exposed: false, exposure_reason: 'hash_protected' }, outpoint)).toBe(false);
    expect(validExposure(exposure, 'cd'.repeat(32) + ':0')).toBe(false);
  });
});
