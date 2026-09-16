import { ChangeDetectorRef } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PaymentConnectivityOverviewComponent } from './payment-connectivity-overview.component';
import { PaymentZapsComponent } from './payment-zaps.component';
import { PaymentConnectivityApiService } from './payment-connectivity.service';

const unavailable = (stage: string) => () => throwError(() => new HttpErrorResponse({
  status: 503, error: { stage, error: 'not connected' },
}));
const cdr = { markForCheck: vi.fn() } as unknown as ChangeDetectorRef;

/**
 * The zap page used to answer a failed request with a valid zap. A 503 now
 * ends in the error state with no verdict.
 */
describe('Payment connectivity pages when the probers are absent', () => {
  it('does not invent a valid zap when the verifier is absent', () => {
    const api = { verifyZap$: unavailable('unavailable-zap-verifier') } as unknown as PaymentConnectivityApiService;
    const component = new PaymentZapsComponent(api, cdr);
    component.verifyZap();
    expect(component.verifying).toBe(false);
    expect(component.report).toBeNull();
    expect(component.error).toContain('unavailable');
  });

  it('shows the overview error state rather than an empty overview', () => {
    const api = { getOverview$: unavailable('unavailable-product-directory') } as unknown as PaymentConnectivityApiService;
    const component = new PaymentConnectivityOverviewComponent(api, cdr);
    component.ngOnInit();
    expect(component.overview).toBeNull();
    expect(component.error).toContain('unavailable');
  });
});
