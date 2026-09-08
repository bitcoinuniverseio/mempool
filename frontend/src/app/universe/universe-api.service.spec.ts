import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '@app/universe/universe-api.service';

interface Recorder {
  service: UniverseApiService;
  urls: string[];
}

function build(
  isBrowser: boolean,
  respond: (url: string) => Observable<unknown> = (url: string) =>
    of(url.includes('/api/v1/chains') ? [] : {}),
): Recorder {
  const urls: string[] = [];
  const httpClient = {
    get: (url: string) => {
      urls.push(url);
      return respond(url);
    },
    post: (url: string) => {
      urls.push(url);
      return respond(url);
    },
  } as unknown as HttpClient;
  const stateService = {
    isBrowser,
    env: {
      NGINX_PROTOCOL: 'https',
      NGINX_HOSTNAME: 'explorer.internal',
      NGINX_PORT: '443',
    },
  } as unknown as StateService;
  return { service: new UniverseApiService(httpClient, stateService), urls };
}

describe('UniverseApiService addressing', () => {
  it('cancels prior Bitcoin health and keeps the other picker rows on mainnet', () => {
    const changed = new BehaviorSubject('');
    const state = { isBrowser: true, env: {}, network: '', networkChanged$: changed } as unknown as StateService;
    const pending = new Map<string, Subject<unknown>>();
    const get = vi.fn((url: string) => {
      const response = new Subject<unknown>();
      pending.set(url, response);
      return response;
    });
    const service = new UniverseApiService({ get } as unknown as HttpClient, state);
    const received: unknown[] = [];
    const subscription = service.getChains$().subscribe(value => received.push(value));
    state.network = 'signet'; changed.next('signet');
    expect(pending.has('/api/v1/chains?network=signet')).toBe(true);
    pending.get('/api/v1/chains?network=mainnet')?.next([{ chain: 'bitcoin', network: 'mainnet' }]);
    expect(received).toEqual([]);
    const rows = ['bitcoin', 'dogecoin', 'zcash'].map(chain => ({ chain, network: chain === 'bitcoin' ? 'signet' : 'mainnet' }));
    pending.get('/api/v1/chains?network=signet')?.next(rows);
    expect(received).toEqual([rows]);
    subscription.unsubscribe();
  });

  it('rejects a capability row from another network', () => {
    const state = { isBrowser: true, env: {}, network: 'signet' } as unknown as StateService;
    const service = new UniverseApiService({ get: () => of([{ chain: 'bitcoin', network: 'mainnet' }]) } as unknown as HttpClient, state);
    let failure: Error | undefined;
    service.getChains$().subscribe({ error: error => failure = error });
    expect(failure?.message).toBe('authority-network-mismatch');
  });

  it('requests selected Bitcoin health and mainnet Dogecoin health separately', () => {
    const urls: string[] = [];
    const state = { isBrowser: true, env: {}, network: 'testnet4' } as unknown as StateService;
    const service = new UniverseApiService({ get: (url: string) => { urls.push(url); return of({}); } } as unknown as HttpClient, state);
    service.getChainStatus$('bitcoin').subscribe();
    service.getChainStatus$('dogecoin').subscribe();
    expect(urls).toEqual(['/api/v1/bitcoin/status?network=testnet4', '/api/v1/dogecoin/status?network=mainnet']);
  });

  it('stays same-origin in the browser', () => {
    const { service, urls } = build(true);
    service.getProtocols$().subscribe();
    service.getStatus$().subscribe();
    service.getSources$().subscribe();
    service.getBackendInfo$().subscribe();
    service.getTransactionFlow$('a'.repeat(64)).subscribe();
    expect(urls).toEqual([
      '/api/v1/universe/protocols?chain=bitcoin&network=mainnet',
      '/api/v1/universe/status?chain=bitcoin&network=mainnet',
      '/api/v1/universe/sources?chain=bitcoin&network=mainnet',
      '/api/v1/backend-info',
      '/api/v1/universe/transactions/' + 'a'.repeat(64) + '?chain=bitcoin&network=mainnet',
    ]);
  });

  it('addresses the gateway explicitly during server-side rendering', () => {
    const { service, urls } = build(false);
    service.getProtocols$().subscribe();
    service.getBackendInfo$().subscribe();
    expect(urls).toEqual([
      'https://explorer.internal:443/api/v1/universe/protocols?chain=bitcoin&network=mainnet',
      'https://explorer.internal:443/api/v1/backend-info',
    ]);
  });

  it('keeps multichain capability, object, and search reads on the same origin', () => {
    const { service, urls } = build(true);
    service.getChains$().subscribe();
    service.getChainStatus$('dogecoin').subscribe();
    service.getChainTransaction$('zcash', 'a'.repeat(64)).subscribe();
    service.search$('tick & rune', 'zcash', true).subscribe();
    expect(urls).toEqual([
      '/api/v1/chains?network=mainnet',
      '/api/v1/dogecoin/status?network=mainnet',
      '/api/v1/zcash/tx/' + 'a'.repeat(64) + '?network=mainnet',
      '/api/v1/universe/search?q=tick%20%26%20rune&chain=zcash&all=true&network=mainnet',
    ]);
  });

  it('searches the selected Bitcoin network and keeps other chains on mainnet', () => {
    const urls: string[] = [];
    const state = { isBrowser: true, env: {}, network: 'signet' } as unknown as StateService;
    const service = new UniverseApiService({ get: (url: string) => {
      urls.push(url);
      return of({ activeChain: url.includes('chain=bitcoin') ? 'bitcoin' : 'dogecoin', groups: [] });
    } } as unknown as HttpClient, state);
    service.search$('abc', 'bitcoin', false).subscribe();
    service.search$('abc', 'dogecoin', true).subscribe();
    expect(urls).toEqual([
      '/api/v1/universe/search?q=abc&chain=bitcoin&all=false&network=signet',
      '/api/v1/universe/search?q=abc&chain=dogecoin&all=true&network=mainnet',
    ]);
  });

  it('rejects a search answered from another network', () => {
    const state = { isBrowser: true, env: {}, network: 'signet' } as unknown as StateService;
    const service = new UniverseApiService({ get: () => of({
      activeChain: 'bitcoin',
      groups: [{ chain: 'bitcoin', network: 'mainnet', results: [] }],
    }) } as unknown as HttpClient, state);
    let failure: Error | undefined;
    service.search$('abc', 'bitcoin', false).subscribe({ error: error => failure = error });
    expect(failure?.message).toBe('authority-network-mismatch');
  });

  it('cancels a search in flight when the network changes', () => {
    const changed = new BehaviorSubject('signet');
    const state = { isBrowser: true, env: {}, network: 'signet', networkChanged$: changed } as unknown as StateService;
    const pending = new Map<string, Subject<unknown>>();
    const service = new UniverseApiService({ get: (url: string) => {
      const response = new Subject<unknown>();
      pending.set(url, response);
      return response;
    } } as unknown as HttpClient, state);
    const received: unknown[] = [];
    const subscription = service.search$('abc', 'bitcoin', false).subscribe(value => received.push(value));
    state.network = 'testnet4'; changed.next('testnet4');
    pending.get('/api/v1/universe/search?q=abc&chain=bitcoin&all=false&network=signet')
      ?.next({ activeChain: 'bitcoin', groups: [{ chain: 'bitcoin', network: 'signet', results: [] }] });
    expect(received).toEqual([]);
    const answer = { activeChain: 'bitcoin', groups: [{ chain: 'bitcoin', network: 'testnet4', results: [] }] };
    pending.get('/api/v1/universe/search?q=abc&chain=bitcoin&all=false&network=testnet4')?.next(answer);
    expect(received).toEqual([answer]);
    subscription.unsubscribe();
  });

  it('uses only allowlisted protocol route segments', () => {
    const { service, urls } = build(true);
    service.getChainProtocolList$('dogecoin', 'doge-tap', 25, 50).subscribe();
    service.getChainProtocolList$('zcash', 'zrc20', 25, 50, 'zord').subscribe();
    expect(urls).toEqual([
      '/api/v1/dogecoin/protocols/doge-tap?network=mainnet&limit=25&offset=50',
      '/api/v1/zcash/protocols/zrc20?network=mainnet&limit=25&ruleset=zord',
    ]);
    expect(() => service.getChainProtocolList$('dogecoin', '../zcash')).toThrow(
      'unsupported-chain-protocol',
    );
  });
});

describe('UniverseApiService pending-set bounds', () => {
  // Zcash refuses a limit above 200 as a bad request rather than trimming it,
  // so a shared default emptied its lens and its arrivals list in production
  // while every fixture answered whatever it was asked.
  it('never asks a chain for more pending transactions than it allows', () => {
    const { service, urls } = build(true);
    service.getChainMempool$('zcash', 400).subscribe();
    service.getChainMempool$('dogecoin', 400).subscribe();
    expect(urls[0]).toContain('limit=200');
    expect(urls[1]).toContain('limit=400');
  });

  it('keeps a request for fewer than the ceiling exactly as asked', () => {
    const { service, urls } = build(true);
    service.getChainMempool$('zcash', 50).subscribe();
    expect(urls[0]).toContain('limit=50');
  });

  it('refuses a limit below one', () => {
    const { service, urls } = build(true);
    service.getChainMempool$('dogecoin', 0).subscribe();
    expect(urls[0]).toContain('limit=1');
  });
});

describe('UniverseApiService protocol registry cache', () => {
  it('fetches the registry once and replays it', () => {
    const get = vi.fn(() => of({ registryVersion: '1.0.0' }));
    const httpClient = { get } as unknown as HttpClient;
    const stateService = { isBrowser: true, env: {} } as unknown as StateService;
    const service = new UniverseApiService(httpClient, stateService);
    service.getProtocols$().subscribe();
    service.getProtocols$().subscribe();
    service.getProtocols$().subscribe();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure, so the next subscriber retries', () => {
    let attempts = 0;
    const get = vi.fn(() => {
      attempts += 1;
      return attempts === 1
        ? throwError(() => new Error('registry down'))
        : of({ registryVersion: '1.0.0' });
    });
    const httpClient = { get } as unknown as HttpClient;
    const stateService = { isBrowser: true, env: {} } as unknown as StateService;
    const service = new UniverseApiService(httpClient, stateService);

    let failed = false;
    service.getProtocols$().subscribe({ error: () => (failed = true) });
    expect(failed).toBe(true);

    let version: string | null = null;
    service
      .getProtocols$()
      .subscribe((response) => (version = (response as { registryVersion: string }).registryVersion));
    expect(version).toBe('1.0.0');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('never caches a transaction flow, whose state changes as it confirms', () => {
    const get = vi.fn(() => of({}));
    const httpClient = { get } as unknown as HttpClient;
    const stateService = { isBrowser: true, env: {} } as unknown as StateService;
    const service = new UniverseApiService(httpClient, stateService);
    const txid = 'b'.repeat(64);
    service.getTransactionFlow$(txid).subscribe();
    service.getTransactionFlow$(txid).subscribe();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
