import { describe, it, expect, vi } from 'vitest';
import { WebsocketService } from './websocket.service';
import { Subject } from 'rxjs';

describe('websocket fee and independent live ingress', () => {
  it('rejects legacy success and empty indicators, and requires separate live proof with actual data', () => {
    const state = { network: '', acceptFeeEstimate: vi.fn(), acceptLiveObservation: vi.fn(), invalidateLiveObservation: vi.fn(),
      loadingIndicators$: new Subject(), isLoadingMempool$: new Subject(), mempoolInfo$: new Subject() };
    const service = Object.create(WebsocketService.prototype) as WebsocketService;
    Object.assign(service, { stateService: state });
    const values = { fastestFee: 2, halfHourFee: 1.5, hourFee: 1, economyFee: 0.5, minimumFee: 0.1 };
    service.handleResponse({ fees: values, loadingIndicators: {} });
    expect(state.acceptFeeEstimate).toHaveBeenLastCalledWith(undefined); expect(state.acceptLiveObservation).not.toHaveBeenCalled();
    const feeEstimate = { schemaVersion: 'universe-fee-estimate-v1' as const, chain: 'bitcoin' as const, network: 'mainnet',
      status: 'ready' as const, observedAt: new Date().toISOString(), tip: { height: 1, hash: 'a'.repeat(64) }, values, reason: null };
    service.handleResponse({ feeEstimate }); expect(state.acceptFeeEstimate).toHaveBeenLastCalledWith(feeEstimate);
    expect(state.acceptLiveObservation).not.toHaveBeenCalled();
    const liveObservation = { ...feeEstimate, schemaVersion: 'universe-live-observation-v1' as const };
    service.handleResponse({ liveObservation }); expect(state.acceptLiveObservation).not.toHaveBeenCalled();
    service.handleResponse({ liveObservation, mempoolInfo: { loaded: true } as never });
    expect(state.acceptLiveObservation).toHaveBeenLastCalledWith(liveObservation.observedAt);
    service.handleResponse({ liveObservation: { ...liveObservation, status: 'syncing', observedAt: null, tip: null, reason: 'syncing' } });
    expect(state.invalidateLiveObservation).toHaveBeenCalledOnce();
  });
});
