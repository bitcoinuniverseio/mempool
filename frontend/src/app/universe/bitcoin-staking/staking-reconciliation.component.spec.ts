import { ChangeDetectorRef } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StakingEvidenceComponent } from './staking-evidence.component';
import { StakingOverviewComponent } from './staking-overview.component';
import { StakingReconciliationComponent } from './staking-reconciliation.component';
import { BitcoinStakingApiService } from './bitcoin-staking.service';

const unavailable = (stage: string) => () => throwError(() => new HttpErrorResponse({
  status: 503, error: { stage, error: 'not connected' },
}));
const cdr = { markForCheck: vi.fn() } as unknown as ChangeDetectorRef;

/**
 * The reconciliation page used to answer a failed request with a
 * synchronized reconciliation and the evidence page swallowed the failure.
 * A 503 now ends in the error state with nothing invented.
 */
describe('Bitcoin staking pages when the indexer is absent', () => {
  it('does not invent a synchronized reconciliation when the consumer chain is absent', () => {
    const api = { reconcile$: unavailable('unavailable-consumer-chain') } as unknown as BitcoinStakingApiService;
    const component = new StakingReconciliationComponent(api, cdr);
    component.ngOnInit();
    expect(component.loading).toBe(false);
    expect(component.result).toBeNull();
    expect(component.error).toContain('unavailable');
  });

  it('surfaces an absent evidence source instead of an empty evidence list', () => {
    const api = { getEvidence$: unavailable('unavailable-staking-indexer') } as unknown as BitcoinStakingApiService;
    const component = new StakingEvidenceComponent(api, cdr);
    component.ngOnInit();
    expect(component.evidenceList).toEqual([]);
    expect(component.error).toContain('unavailable');
  });

  it('shows the overview error state rather than an empty overview', () => {
    const api = { getOverview$: unavailable('unavailable-staking-indexer') } as unknown as BitcoinStakingApiService;
    const component = new StakingOverviewComponent(api, cdr);
    component.ngOnInit();
    expect(component.overview).toBeNull();
    expect(component.error).toContain('unavailable');
  });
});
