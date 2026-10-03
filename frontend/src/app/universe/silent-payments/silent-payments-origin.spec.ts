import { describe, expect, it, vi } from 'vitest';
import { ReplaySubject, Subject, of } from 'rxjs';
import { SilentPaymentsApiService } from './silent-payments.service';

function setup(root = '', browser = true) {
  const changes = new ReplaySubject<string>(1);
  const state = {network: 'signet', networkChanged$: changes, isBrowser: browser,
    env: {ROOT_NETWORK: root, NGINX_PROTOCOL: 'http', NGINX_HOSTNAME: 'owned-preview', NGINX_PORT: 4406}};
  changes.next('signet');
  const http = {get: vi.fn(() => of({chain: 'bitcoin', network: state.network})), post: vi.fn(() => of({valid: false}))};
  return {state, changes, http, api: new SilentPaymentsApiService(http as any, state as any)};
}
describe('Silent Payments selected backend origin', () => {
  it('routes coverage, parser and raw bundle reads to the selected Signet backend', () => {
    const {api, http} = setup();
    api.getCoverage$().subscribe(); api.validateAddress$('invalid').subscribe(); api.getBlockBundleBytes$(42).subscribe();
    expect(http.get.mock.calls.map(call => call[0])).toEqual([
      '/signet/api/v1/intelligence/payments/silent/coverage?chain=bitcoin&network=signet',
      '/signet/api/v1/intelligence/payments/silent/blocks/42/bundle?chain=bitcoin&network=signet',
    ]);
    expect(http.post).toHaveBeenCalledWith('/signet/api/v1/intelligence/payments/silent/validate-address?chain=bitcoin&network=signet', {address: 'invalid'});
    expect(api.path('/payments/silent')).toBe('/signet/payments/silent');
  });
  it('respects an explicit Signet root and the SSR origin without adding a second prefix', () => {
    const {api, http} = setup('signet', false);
    api.getCoverage$().subscribe();
    expect(http.get).toHaveBeenCalledWith('http://owned-preview:4406/api/v1/intelligence/payments/silent/coverage?chain=bitcoin&network=signet');
    expect(api.path('/payments/silent')).toBe('/payments/silent');
  });
  it('cancels the old context and captures the selected backend at subscription', () => {
    const {api, http, state, changes} = setup(); const pending = new Subject();
    http.get.mockReturnValue(pending as any);
    api.getCoverage$().subscribe(); expect(pending.observed).toBe(true);
    const deferred = api.getCoverage$(); const bundle = api.getBlockBundleBytes$(42);
    state.network = 'testnet4'; changes.next('testnet4');
    expect(pending.observed).toBe(false); deferred.subscribe();
    expect(http.get).toHaveBeenLastCalledWith('/testnet4/api/v1/intelligence/payments/silent/coverage?chain=bitcoin&network=testnet4');
    bundle.subscribe();
    expect(http.get).toHaveBeenLastCalledWith('/testnet4/api/v1/intelligence/payments/silent/blocks/42/bundle?chain=bitcoin&network=testnet4', {responseType: 'text'});
  });
});
