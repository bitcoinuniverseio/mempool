import { ChangeDetectorRef } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { LightClientFiltersComponent } from './light-client-filters.component';
import { LightClientOverviewComponent } from './light-client-overview.component';
import { LightClientVerifyComponent } from './light-client-verify.component';
import { CompactFiltersApiService } from './compact-filters.service';

const unavailable = (stage: string) => () => throwError(() => new HttpErrorResponse({
  status: 503, error: { stage, error: 'not connected' },
}));
const cdr = { markForCheck: vi.fn() } as unknown as ChangeDetectorRef;

/**
 * The filter and verifier pages used to answer a failed request with a
 * constant filter and a four-peer consensus. A 503 now ends in the error
 * state with nothing invented.
 */
describe('Light client pages when the filter sources are absent', () => {
  it('does not invent a block filter when the filter index is absent', () => {
    const api = { getBlockFilter$: unavailable('unavailable-filter-index') } as unknown as CompactFiltersApiService;
    const component = new LightClientFiltersComponent(api, cdr);
    expect(component.fetching).toBe(false);
    expect(component.filter).toBeNull();
    expect(component.error).toContain('unavailable');
  });

  it('does not invent peer consensus when the prober is absent', () => {
    const api = { executeVerification$: unavailable('unavailable-filter-peers') } as unknown as CompactFiltersApiService;
    const component = new LightClientVerifyComponent(api, cdr);
    component.runVerification();
    expect(component.verifying).toBe(false);
    expect(component.report).toBeNull();
    expect(component.error).toContain('unavailable');
  });

  it('shows the overview error state rather than an empty overview', () => {
    const api = { getOverview$: unavailable('unavailable-filter-peers') } as unknown as CompactFiltersApiService;
    const component = new LightClientOverviewComponent(api, cdr);
    component.ngOnInit();
    expect(component.overview).toBeNull();
    expect(component.error).toContain('unavailable');
  });
});
