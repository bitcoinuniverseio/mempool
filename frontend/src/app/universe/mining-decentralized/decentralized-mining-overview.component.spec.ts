import { describe, expect, it } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { DecentralizedMiningOverviewComponent } from './decentralized-mining-overview.component';
import { DecentralizedMiningCompareComponent } from './decentralized-mining-compare.component';
import type { DecentralizedMiningApiService } from './decentralized-mining.service';

/**
 * The backend answers these reads with a 503 that names the missing share
 * feeds. The pages must land in their error state with the shared message;
 * the comparison page used to swallow the failure and keep rendering.
 */
const unavailable = new HttpErrorResponse({ status: 503, error: { stage: 'unavailable-share-source', error: 'absent' } });
const api = {
  getOverview$: () => throwError(() => unavailable),
  getTemplateComparison$: () => throwError(() => unavailable),
} as unknown as DecentralizedMiningApiService;
const cdr = { markForCheck: () => undefined } as never;

describe('decentralized mining pages on absent share feeds', () => {
  it('shows the unavailable message on the overview instead of a spinner', () => {
    const page = new DecentralizedMiningOverviewComponent(api, cdr);
    page.ngOnInit();
    expect(page.loading).toBe(false);
    expect(page.overview).toBeNull();
    expect(page.error).toBe('The service behind this panel is unavailable.');
  });

  it('shows the unavailable message on the comparison page instead of silently continuing', () => {
    const page = new DecentralizedMiningCompareComponent(api, cdr);
    page.ngOnInit();
    expect(page.loading).toBe(false);
    expect(page.comparison).toBeNull();
    expect(page.error).toBe('The service behind this panel is unavailable.');
  });
});
