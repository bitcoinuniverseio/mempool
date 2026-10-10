import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { FeesBoxComponent } from './fees-box.component';
import { FeeEstimateState } from '@app/services/fee-estimate';

describe('fee box shared source state', () => {
  let fees: FeeEstimateState;
  beforeEach(() => { vi.useFakeTimers(); fees = new FeeEstimateState(); });
  afterEach(() => { fees.destroy(); vi.useRealTimers(); });
  it('empty indicators do not assert fee readiness; disconnect is explicitly stale and switch clears values', () => {
    const state = { feeEstimate$: fees.snapshot$, liveFeed$: new BehaviorSubject({ status: 'data' }), loadingIndicators$: new BehaviorSubject({}) };
    const component = new FeesBoxComponent(state as never,
      { themeState$: new BehaviorSubject({ loading: false }), mempoolFeeColors: ['123456', 'abcdef'] } as never,
      { markForCheck: vi.fn() } as never, { reconnectWebsocket: vi.fn() } as never);
    component.ngOnInit();
    let loading: boolean;
    const loadingSubscription = component.isLoading$.subscribe(value => loading = value);
    const subscription = component.feeEstimate$.subscribe();
    expect(loading).toBe(true); expect(component.fees).toBeNull();
    fees.accept({ schemaVersion: 'universe-fee-estimate-v1', chain: 'bitcoin', network: 'mainnet', status: 'ready',
      observedAt: new Date().toISOString(), tip: { height: 1, hash: 'a'.repeat(64) }, reason: null,
      values: { fastestFee: 2, halfHourFee: 1.5, hourFee: 1, economyFee: 0.5, minimumFee: 0.1 } });
    expect(component.fees.fastestFee).toBe(2); expect(loading).toBe(false);
    fees.offline(); expect(fees.snapshot$.value.status).toBe('stale'); expect(component.fees.fastestFee).toBe(2);
    fees.reset('signet'); expect(component.fees).toBeNull(); expect(component.noPriority).toBe('var(--skeleton-bg)');
    subscription.unsubscribe(); loadingSubscription.unsubscribe(); component.ngOnDestroy();
  });
  it('retry reconnects the shared socket and is disabled during bounded recovery', () => {
    const reconnect = vi.fn(() => fees.retry());
    const component = new FeesBoxComponent({ feeEstimate$: fees.snapshot$ } as never, {} as never, {} as never,
      { reconnectWebsocket: reconnect } as never);
    component.retry(); expect(reconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000); component.retry(); component.retry(); expect(reconnect).toHaveBeenCalledTimes(1);
  });
});
