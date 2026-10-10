import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { FiatComponent } from '../fiat/fiat.component';

describe('shared fiat quote validity', () => {
  function fixture(): FiatComponent { return new FiatComponent({ fiatCurrency$: new BehaviorSubject('USD') } as never, { markForCheck: vi.fn() } as never); }
  it.each([-1, -0.5, 0, NaN, Infinity, -Infinity])('never renders missing/invalid rate %s as a price', rate => {
    const component = fixture(); expect(component.rateFrom({ USD: rate })).toBeNull();
    component.blockConversion = { price: { USD: rate } } as never; expect(component.blockRate()).toBeNull(); component.ngOnDestroy();
  });
  it('preserves a zero amount at a valid price and validates the entire exchange-rate product', () => {
    const component = fixture(); component.value = 0; expect(component.rateFrom({ USD: 100 })).toBe(100); expect(component.converted(100)).toBe(0);
    component.currency = 'EUR';
    for (const rate of [0, -1, Infinity, NaN]) { component.blockConversion = { price: { USD: 100 }, exchangeRates: { USDEUR: rate } } as never; expect(component.blockRate()).toBeNull(); }
    component.blockConversion = { price: { USD: Number.MAX_VALUE }, exchangeRates: { USDEUR: 2 } } as never; expect(component.blockRate()).toBeNull();
    component.blockConversion = { price: { USD: 100 }, exchangeRates: { USDEUR: 0.9 } } as never; expect(component.blockRate()).toBe(90); component.ngOnDestroy();
  });
});
