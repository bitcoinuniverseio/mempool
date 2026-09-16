import { describe, expect, it } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { ReservesOverviewComponent } from './reserves-overview.component';
import { ReservesProvidersComponent } from './reserves-providers.component';
import type { ReservesApiService } from './reserves.service';

/**
 * The backend answers these reads with a 503 that names the missing
 * attestation ingest. The pages must land in their error state with the
 * shared message, not on a spinner and not on an empty table.
 */
const unavailable = new HttpErrorResponse({ status: 503, error: { stage: 'unavailable-attestation-ingest', error: 'absent' } });
const api = {
  getOverview: () => throwError(() => unavailable),
  getProviders: () => throwError(() => unavailable),
} as unknown as ReservesApiService;
const cd = { markForCheck: () => undefined } as never;

describe('reserves pages on an absent attestation ingest', () => {
  it('shows the unavailable message on the overview instead of a spinner', () => {
    const page = new ReservesOverviewComponent(api, cd);
    page.ngOnInit();
    expect(page.loading).toBe(false);
    expect(page.overview).toBeNull();
    expect(page.error).toBe('The service behind this panel is unavailable.');
  });

  it('shows the unavailable message on the provider directory instead of an empty list', () => {
    const page = new ReservesProvidersComponent(api, cd);
    page.ngOnInit();
    expect(page.loading).toBe(false);
    expect(page.providers).toEqual([]);
    expect(page.error).toBe('The service behind this panel is unavailable.');
  });
});
