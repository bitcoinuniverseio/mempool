import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of, Subject } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { ClockComponent } from './clock.component';
import { FeeEstimateState } from '@app/services/fee-estimate';

describe('clock fee observation state', () => {
  let fees: FeeEstimateState;
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', { innerWidth: 360, innerHeight: 800 }); fees = new FeeEstimateState(); });
  afterEach(() => { fees.destroy(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('shares validated fee state, original stale timestamp and synchronous network clearing', () => {
    const reconnect = vi.fn(() => fees.retry());
    const state = { feeEstimate$: fees.snapshot$, blocks$: new Subject(), mempoolInfo$: new Subject(), env: { BLOCK_WEIGHT_UNITS: 4000000 } };
    const component = new ClockComponent(state as never, { want: vi.fn(), reconnectWebsocket: reconnect } as never,
      { queryParams: of({}), paramMap: of(convertToParamMap({ mode: 'mined', index: '0' })) } as never,
      { navigate: vi.fn() } as never, { transform: (x: string) => x } as never, { markForCheck: vi.fn() } as never);
    component.ngOnInit(); expect(component.feeEstimate$).toBe(fees.snapshot$); expect(component.clockSize).toBe(360);
    const observedAt = new Date().toISOString();
    fees.accept({ schemaVersion: 'universe-fee-estimate-v1', chain: 'bitcoin', network: 'mainnet', status: 'ready', observedAt,
      tip: { height: 1, hash: 'a'.repeat(64) }, reason: null,
      values: { fastestFee: 2, halfHourFee: 1.5, hourFee: 1, economyFee: 0.5, minimumFee: 0.1 } });
    fees.offline(); expect(fees.snapshot$.value.observedAt).toBe(observedAt); expect(fees.snapshot$.value.status).toBe('stale');
    component.retryFees(); component.retryFees(); expect(reconnect).toHaveBeenCalledTimes(1);
    fees.reset('signet'); expect(fees.snapshot$.value.values).toBeNull();
    component.pageSubscription.unsubscribe(); component.blocksSubscription.unsubscribe();
  });
});
