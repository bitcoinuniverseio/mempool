import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of, skipWhile } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseWebsocketService } from '@app/universe/universe-websocket.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { ChainDashboardService } from '@app/universe/chain-dashboard/chain-dashboard.service';
import { configuredChainNetworks } from '@app/universe/chain-network';

// The consumers of UNIVERSE_CHAIN_NETWORKS: an explicit setting that is wrong
// must reach none of them as a mainnet read, and each must say so.

const ownerKeyStub = { headers: () => ({}), key: null };

function state(chainNetworks: unknown, isBrowser = true): StateService {
  return { isBrowser, network: '', env: { UNIVERSE_CHAIN_NETWORKS: chainNetworks } } as unknown as StateService;
}

describe('network configuration consumers', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  beforeEach(() => { configuredChainNetworks({}); warn.mockClear(); });
  afterEach(() => { configuredChainNetworks({}); vi.unstubAllGlobals(); });

  it('turns an invalid Dogecoin setting into a dashboard configuration error with no request sent', async () => {
    const urls: string[] = [];
    const env = state({ dogecoin: 'signet' });
    const api = new UniverseApiService({ get: (url: string) => { urls.push(url); return of({}); } } as unknown as HttpClient, env, ownerKeyStub as never);
    const dashboards = new ChainDashboardService(api, new UniverseWebsocketService(state({ dogecoin: 'signet' }, false)), { capability$: () => of(null) } as never);
    const dashboard = await firstValueFrom(dashboards.dashboard$('dogecoin'));
    const pending = await firstValueFrom(dashboards.pending$('dogecoin'));
    expect(dashboard).toEqual({ view: null, error: 'network-config-invalid', stale: true });
    expect(pending.payload).toBeNull();
    expect(urls).toEqual([]);
  });

  it('keeps reading a correctly configured chain beside the invalid one', async () => {
    const urls: string[] = [];
    const env = state({ dogecoin: 'signet', zcash: 'testnet' });
    const api = new UniverseApiService({ get: (url: string) => { urls.push(url); return of({ chain: 'zcash', network: 'testnet' }); } } as unknown as HttpClient, env, ownerKeyStub as never);
    const dashboards = new ChainDashboardService(api, new UniverseWebsocketService(state({}, false)), { capability$: () => of(null) } as never);
    const dashboard = await firstValueFrom(dashboards.dashboard$('zcash').pipe(skipWhile(value => value.view === null && value.error === null)));
    expect(dashboard.error).toBeNull();
    expect(urls).toEqual(['/api/v1/zcash/dashboard?network=testnet']);
  });

  it('opens no live socket for a chain whose setting is invalid', () => {
    const sockets: string[] = [];
    vi.stubGlobal('WebSocket', class { constructor(url: string) { sockets.push(url); } addEventListener(): void { /* not reached */ } });
    vi.stubGlobal('location', { protocol: 'https:', host: 'explorer.test' });
    const live = new UniverseWebsocketService(state('{"dogecoin":'));
    let completed = false;
    let failed = false;
    live.stream$('dogecoin').subscribe({ complete: () => completed = true, error: () => failed = true });
    expect(sockets).toEqual([]);
    expect(completed).toBe(true);
    expect(failed).toBe(false);
  });

  it('never files a visit or bookmark under a substitute network', () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string): string | null => (store.has(key) ? store.get(key) : null),
      setItem: (key: string, value: string): void => void store.set(key, value),
      removeItem: (key: string): void => void store.delete(key),
    };
    const local = new UniverseLocalService(state({ dogecoin: 'testnet3' }));
    const entry = { chain: 'dogecoin' as const, kind: 'transaction' as const, value: 'a'.repeat(64), path: '/dogecoin/tx/' + 'a'.repeat(64), label: 'tx' };
    local.recordVisit(entry);
    expect(local.recentSnapshot()).toEqual([]);
    expect(local.toggleBookmark(entry)).toBe(false);
    expect(local.isBookmarked('transaction', 'a'.repeat(64), 'dogecoin')).toBe(false);
    // An entry that already names its network keeps it.
    local.recordVisit({ ...entry, network: 'testnet' });
    expect(local.recentSnapshot().map(item => item.network)).toEqual(['testnet']);
  });

  it('renders the configuration error on the dashboard and mining pages instead of the generic outage text', () => {
    for (const file of ['./chain-dashboard/chain-dashboard.component.html', './chain-dashboard/chain-mining.component.html']) {
      const template = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(template).toMatch(/role="alert" \*ngIf="networkConfigError"/);
      expect(template).toContain("vm.viewError !== 'network-config-invalid'");
    }
  });
});
