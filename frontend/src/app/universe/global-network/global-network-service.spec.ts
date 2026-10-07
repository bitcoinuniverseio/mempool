import { afterEach, describe, expect, it, vi } from 'vitest';
import { from, of, Subject } from 'rxjs';
import { apiGet, strategyFor } from '../../../universe-service-worker.js';
import { HttpRequest } from '@angular/common/http';
import { NetworkPrefixInterceptor } from '@app/services/network-prefix.interceptor';
import { GlobalNetworkApiService } from './global-network.service';

// Controlled fixtures use the existing mounted producer envelopes, not native-source attestations.
const seed = { seed_id: 'seed-controlled', hostname: 'seed.example.org', maintainer: 'chainparams',
  active: null, last_query_at: '2026-10-05T00:00:00Z', discovered_addrs_count: null,
  reachable_ratio: null, error: 'controlled resolver unavailable' };
const snapshot = { snapshot_id: 'snapshot-controlled', network: 'signet', block_height: 102,
  timestamp_utc: '2026-10-05T00:00:00Z', total_nodes: 0, v2_percentage: null,
  top_asns: [], top_clients: [], geo_distribution: [], scope: 'peers connected to the owned node' };
const sensor = { sensor_id: 'sensor-owned-node', region: 'Universe infrastructure', software_version: '/Satoshi:30.3.0/',
  status: 'active', v1_supported: true, v2_bip324_supported: null, addrv2_bip155_supported: null,
  last_probe_utc: '2026-10-05T00:00:00Z', reachable_networks: ['ipv4'] };
const state = { isBrowser: true, network: '', env: { ROOT_NETWORK: 'signet', BASE_MODULE: 'mempool' } };
const owned = { chain_network: 'signet', genesis_hash: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  observed_at_utc: '2026-10-05T00:00:00Z', age_ms: 0, freshness_limit_ms: 30000, scope: 'Peers connected to the owned node; not a census.' };
const configured = { configured_network: 'signet', scope: 'Configured source selection; not independent node identity.' };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Global Network current producer transport contract', () => {
  for (const [method, key, row] of [['getDnsSeeds$', 'seeds', seed], ['getSnapshots$', 'snapshots', snapshot],
    ['getSensors$', 'sensors', sensor]] as const) {
    it(`unwraps the actual ${key} envelope without inventing unknown facts`, () => {
      const envelope = { [key]: [row], total: 1, ...(key === 'sensors' ? owned : configured) };
      const http = { get: vi.fn().mockReturnValue(of(envelope)) };
      const service = new GlobalNetworkApiService(http as any, state as any);
      const next = vi.fn(); service[method]().subscribe(next);
      expect(next).toHaveBeenCalledWith(envelope);
    });
  }

  it('marks reads no-store so the PWA cannot serve an offline cached observation', () => {
    const http = { get: vi.fn().mockReturnValue(of({ seeds: [], total: 0, ...configured })) };
    new GlobalNetworkApiService(http as any, state as any).getDnsSeeds$().subscribe();
    const options = http.get.mock.calls[0][1];
    const headers = options?.headers;
    expect(headers?.get ? headers.get('Cache-Control') : headers?.['Cache-Control']).toBe('no-store');
  });

  it('bounds a never-responding read and releases its subscription at 15 seconds', () => {
    vi.useFakeTimers(); const pending = new Subject(); const error = vi.fn();
    const http = { get: vi.fn().mockReturnValue(pending) };
    const subscription = new GlobalNetworkApiService(http as any, state as any).getOverview$().subscribe({ error });
    try {
      expect(pending.observed).toBe(true); vi.advanceTimersByTime(15001);
      expect(error).toHaveBeenCalledOnce(); expect(pending.observed).toBe(false);
    } finally { subscription.unsubscribe(); }
  });

  it('rejects cached offline Global snapshots through the actual service-worker strategy', async () => {
    const wrapper = { snapshots: [snapshot], total: 1, ...configured };
    const cached = new Response(JSON.stringify(wrapper), { headers: { 'Content-Type': 'application/json' } });
    const match = vi.fn(async () => cached.clone());
    vi.stubGlobal('caches', { open: async () => ({ put: async () => {}, keys: async () => [], delete: async () => true }), match });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('Controlled offline source')));
    const url = 'http://localhost:8999/api/v1/intelligence/network/global/snapshots';
    const ordinary = new Request(url);
    expect(strategyFor(new URL(url), ordinary)).toBe('network-first');
    expect(await (await apiGet(ordinary)).json()).toEqual(wrapper); match.mockClear();
    const next = vi.fn(), error = vi.fn(), requests: Request[] = [];
    const http = { get: (requestUrl: string, options?: { headers?: Record<string, string> }) => {
      const request = new Request(requestUrl, { headers: options?.headers }); requests.push(request);
      return from(apiGet(request).then(response => response.json()));
    } };
    const ssrState = { ...state, isBrowser: false,
      env: { ...state.env, NGINX_PROTOCOL: 'http', NGINX_HOSTNAME: 'localhost', NGINX_PORT: 8999 } };
    const subscription = new GlobalNetworkApiService(http as any, ssrState as any).getSnapshots$().subscribe({ next, error });
    try {
      await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
      expect(next).not.toHaveBeenCalled(); expect(match).not.toHaveBeenCalled();
      expect(strategyFor(new URL(url), requests[0])).toBeNull();
    } finally { subscription.unsubscribe(); }
  });

  it('preserves actual interceptor selected routing and avoids double prefixes', () => {
    for (const [network, input, expected] of [
      ['testnet4', '/api/v1/intelligence/network/global/seeds', '/testnet4/api/v1/intelligence/network/global/seeds'],
      ['', '/api/v1/intelligence/network/global/seeds', '/api/v1/intelligence/network/global/seeds'],
      ['signet', '/signet/api/v1/intelligence/network/global/seeds', '/signet/api/v1/intelligence/network/global/seeds'],
    ]) {
      const handle = vi.fn().mockReturnValue(of());
      new NetworkPrefixInterceptor({ ...state, network } as any).intercept(new HttpRequest('GET', input), { handle });
      expect(handle.mock.calls[0][0].url).toBe(expected);
    }
  });

  it('captures context on subscription, rejects a late old context and permits a fresh retry', () => {
    const pending = new Subject(), currentState = { ...state, env: { ...state.env } };
    const http = { get: vi.fn().mockReturnValueOnce(pending)
      .mockReturnValueOnce(of({ ...configured, configured_network: 'testnet4', seeds: [seed], total: 1 })) };
    const service = new GlobalNetworkApiService(http as any, currentState as any), next = vi.fn(), error = vi.fn();
    const old = service.getDnsSeeds$().subscribe({ next, error });
    currentState.network = 'testnet4'; pending.next({ ...configured, seeds: [seed], total: 1 });
    expect(error).toHaveBeenCalledOnce(); expect(next).not.toHaveBeenCalled(); expect(pending.observed).toBe(false);
    service.getDnsSeeds$().subscribe(next); expect(next).toHaveBeenCalledOnce(); old.unsubscribe();
  });

  it('refuses invalid page and endpoint inputs before source I/O', () => {
    const http = { get: vi.fn() }, service = new GlobalNetworkApiService(http as any, state as any), error = vi.fn();
    service.getNodes$(501, 0).subscribe({ error }); service.getNodes$(100, -1).subscribe({ error });
    service.getNodeDetail$('').subscribe({ error });
    expect(error).toHaveBeenCalledTimes(3); expect(http.get).not.toHaveBeenCalled();
  });
});
