import { describe, expect, it, vi } from 'vitest';
import { Subject, of } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';
import { PolicyLabComponent } from './policy-lab.component';
import { networkScopedUrl } from '@app/services/network-prefix.interceptor';

function setup(network: string, rootNetwork = 'mainnet', isBrowser = true) {
  const state: any = { network, isBrowser, networkChanged$: new Subject<string>(), env: { BASE_MODULE: 'mempool', ROOT_NETWORK: rootNetwork, NGINX_PROTOCOL: 'https', NGINX_HOSTNAME: 'owned.internal', NGINX_PORT: 443 } };
  const http: any = { get: vi.fn(() => of({})), post: vi.fn(() => of({})), delete: vi.fn(() => of({})) };
  // Use the actual shared interceptor; service URLs alone are not the dispatched routes.
  const dispatch: any = Object.fromEntries(['get', 'post', 'delete'].map(method => [method, (url: string, ...args: unknown[]) => http[method](networkScopedUrl(url, state), ...args)]));
  const api = new IntelligenceApiService(dispatch, state, { headers: () => ({ 'X-Owner-Test': 'component-fixture' }) } as any);
  return { state, http, api };
}

describe('Intelligence selected backend network', () => {
  it('addresses explicit Signet reads and policy submission to the selected backend', () => {
    const { api, http } = setup('signet');
    api.getNodeProfiles$().subscribe(); api.getRelayOverview$().subscribe(); api.evaluatePackage$(['00']).subscribe();
    expect(http.get.mock.calls.map((call: any[]) => call[0])).toEqual(['/signet/api/v1/intelligence/policy/profiles', '/signet/api/v1/intelligence/relay/overview']);
    expect(http.post.mock.calls[0]).toEqual(['/signet/api/v1/intelligence/policy/evaluations', { transactions: ['00'] }]);
  });
  it.each(['', 'signet'])('keeps the configured Signet root prefix empty for selector %s', network => {
    const { api, http } = setup(network, 'signet'); api.getRelayOverview$().subscribe();
    expect(http.get.mock.calls[0][0]).toBe('/api/v1/intelligence/relay/overview');
  });
  it('reads the current selection for each request after a context change', () => {
    const { api, http, state } = setup('signet'); api.getRelayOverview$().subscribe();
    state.network = 'testnet4'; api.getRelayOverview$().subscribe();
    expect(http.get.mock.calls[1][0]).toBe('/testnet4/api/v1/intelligence/relay/overview');
  });
  it('preserves owner headers, saved-query cursors and mutation bodies in the selected partition', () => {
    const { api, http } = setup('signet');
    api.getSavedQueryPage$('opaque+cursor').subscribe(); api.saveQuery$('owned', 'SELECT txid FROM transactions').subscribe(); api.deleteWatchlist$('list/1').subscribe();
    const headers = { headers: { 'X-Owner-Test': 'component-fixture' } };
    expect(http.get.mock.calls[0]).toEqual(['/signet/api/v1/intelligence/query/saved?limit=100&cursor=opaque%2Bcursor', headers]);
    expect(http.post.mock.calls[0]).toEqual(['/signet/api/v1/intelligence/query/saved', { title: 'owned', sql: 'SELECT txid FROM transactions' }, headers]);
    expect(http.delete.mock.calls[0]).toEqual(['/signet/api/v1/intelligence/watchlists/list%2F1', headers]);
  });
  it('preserves mainnet routing and the configured server-rendering host', () => {
    const { api, http } = setup('mainnet', 'mainnet', false); api.getNodeProfiles$().subscribe();
    expect(http.get.mock.calls[0][0]).toBe('https://owned.internal:443/api/v1/intelligence/policy/profiles');
    const selected = setup('signet', 'mainnet', false); selected.api.getNodeProfiles$().subscribe();
    expect(selected.http.get.mock.calls[0][0]).toBe('https://owned.internal:443/signet/api/v1/intelligence/policy/profiles');
  });
  it('selects the actual root network for the policy profile and submitted-byte verdict', async () => {
    const { state } = setup('', 'signet');
    const raw = '00', responses = new Subject<any>();
    const page = new PolicyLabComponent({ getNodeProfiles$: () => of({ profiles: [{ network: 'signet', subversion: 'native-fixture' }] }), evaluatePackage$: () => responses } as any, { markForCheck: () => {} } as any, state);
    page.ngOnInit(); expect(page.nodeProfile?.network).toBe('signet');
    page.rawTransactionsInput = raw; await page.evaluate();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
    responses.next({ package_report: { input_hash: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''), network: 'signet', members: [{}] } });
    expect(page.evaluationResult).not.toBeNull(); page.ngOnDestroy();
  });
});
