import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { LightningStandardsComponent } from './lightning-standards.component';

function component(failedOffers = false) {
  const api = {
    getBolt12Offers$: () => failedOffers ? throwError(() => new HttpErrorResponse({ status: 503 })) : of({ offers: [] }),
    getLightningRfq$: () => of({ quotes: [{ quoteId: 'owned-quote', validUntil: 1700000000 }] }),
  } as unknown as UniverseApiService;
  return new LightningStandardsComponent(api, { setTitle: vi.fn() } as unknown as SeoService);
}

describe('Lightning standards source evidence', () => {
  it('does not promote false or absent source validity to verification', () => {
    const view = component();
    expect(view.offerValidityLabel(true)).toBe('Source reports valid');
    expect(view.offerValidityLabel(false)).toBe('Source reports invalid');
    expect(view.offerValidityLabel(undefined)).toBe('Validity not reported');
    expect(view.offerValidityLabel('true')).toBe('Validity not reported');
  });

  it('renders the supplied Unix expiry, including an expired quote, without renewing it', () => {
    const view = component();
    expect(view.quoteExpiry(1700000000)).toBe('2023-11-14T22:13:20.000Z');
    expect(view.quoteExpiry(NaN)).toBe('Not reported');
    expect(view.quoteExpiry(-1)).toBe('Not reported');
  });

  it('retains the successful RFQ data while exposing offers unavailability', () => {
    const view = component(true);
    view.ngOnInit();
    let observed: any;
    const subscription = view.vm$.subscribe(value => { observed = value; });
    expect(observed.kind).toBe('error');
    expect(observed.offersError).toBeTruthy();
    expect(observed.quotesError).toBeNull();
    expect(observed.quotes[0].quoteId).toBe('owned-quote');
    subscription.unsubscribe();
  });
});
