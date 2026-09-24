import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ChainNetworkUnavailableError, configuredChainNetworks } from '@app/universe/chain-network';

// Owner-scoped calls read a bearer header from this; the specs here make none.
const ownerKeyStub = { headers: () => ({}), key: null };

interface Recorder {
  service: UniverseApiService;
  urls: string[];
}

function build(
  isBrowser: boolean,
  respond: (url: string) => Observable<unknown> = capabilityRows,
  chainNetworks?: unknown,
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
      UNIVERSE_CHAIN_NETWORKS: chainNetworks,
    },
  } as unknown as StateService;
  return { service: new UniverseApiService(httpClient, stateService, ownerKeyStub as never), urls };
}

/** Answers a per-chain capability read with a row that matches its own URL. */
function capabilityRows(url: string): Observable<unknown> {
  const match = /\/api\/v1\/chains\/([a-z]+)\?network=([a-z0-9]+)/.exec(url);
  return of(match ? { chain: match[1], network: match[2] } : {});
}

describe('UniverseApiService addressing', () => {
  it('cancels prior Bitcoin health and keeps the other picker rows on their own network', () => {
    const changed = new BehaviorSubject('');
    const state = { isBrowser: true, env: {}, network: '', networkChanged$: changed } as unknown as StateService;
    const pending = new Map<string, Subject<unknown>>();
    const get = vi.fn((url: string) => {
      const response = new Subject<unknown>();
      pending.set(url, response);
      return response;
    });
    const service = new UniverseApiService({ get } as unknown as HttpClient, state, ownerKeyStub as never);
    const received: unknown[] = [];
    const subscription = service.getChains$().subscribe(value => received.push(value));
    state.network = 'signet'; changed.next('signet');
    expect(pending.has('/api/v1/chains/bitcoin?network=signet')).toBe(true);
    expect(pending.has('/api/v1/chains/dogecoin?network=mainnet')).toBe(true);
    expect(pending.has('/api/v1/chains/zcash?network=mainnet')).toBe(true);
    pending.get('/api/v1/chains/bitcoin?network=mainnet')?.next({ chain: 'bitcoin', network: 'mainnet' });
    expect(received).toEqual([]);
    const rows = ['bitcoin', 'dogecoin', 'zcash'].map(chain => ({ chain, network: chain === 'bitcoin' ? 'signet' : 'mainnet' }));
    for (const row of rows) {
      const response = pending.get('/api/v1/chains/' + row.chain + '?network=' + row.network);
      response?.next(row); response?.complete();
    }
    expect(received).toEqual([rows]);
    subscription.unsubscribe();
  });

  it('rejects a capability row from another network', () => {
    const state = { isBrowser: true, env: {}, network: 'signet' } as unknown as StateService;
    const service = new UniverseApiService({ get: () => of({ chain: 'bitcoin', network: 'mainnet' }) } as unknown as HttpClient, state, ownerKeyStub as never);
    let failure: Error | undefined;
    service.getChains$().subscribe({ error: error => failure = error });
    expect(failure?.message).toBe('authority-network-mismatch');
  });

  it('requests selected Bitcoin health and mainnet Dogecoin health separately', () => {
    const urls: string[] = [];
    const state = { isBrowser: true, env: {}, network: 'testnet4' } as unknown as StateService;
    const service = new UniverseApiService({ get: (url: string) => { urls.push(url); return of({}); } } as unknown as HttpClient, state, ownerKeyStub as never);
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
      '/api/v1/chains/bitcoin?network=mainnet',
      '/api/v1/chains/dogecoin?network=mainnet',
      '/api/v1/chains/zcash?network=mainnet',
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
    } } as unknown as HttpClient, state, ownerKeyStub as never);
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
    }) } as unknown as HttpClient, state, ownerKeyStub as never);
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
    } } as unknown as HttpClient, state, ownerKeyStub as never);
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

describe('UniverseApiService chain network context', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  beforeEach(() => { warn.mockClear(); configuredChainNetworks({}); });

  it('reads every chain from mainnet when nothing is configured', () => {
    const { service, urls } = build(true);
    service.getChainDashboard$('dogecoin').subscribe();
    service.getChainProtocolList$('zcash', 'zrc20').subscribe();
    expect(urls).toEqual([
      '/api/v1/dogecoin/dashboard?network=mainnet',
      '/api/v1/zcash/protocols/zrc20?network=mainnet&limit=100',
    ]);
    expect(service.chainNetwork('dogecoin')).toBe('mainnet');
    expect(warn).not.toHaveBeenCalled();
  });

  it('sends every Dogecoin read to the configured network while Zcash stays on mainnet and Bitcoin follows the selector', () => {
    const urls: string[] = [];
    const state = { isBrowser: true, network: 'signet', env: { UNIVERSE_CHAIN_NETWORKS: { dogecoin: 'testnet' } } } as unknown as StateService;
    const service = new UniverseApiService({ get: (url: string) => { urls.push(url); return of(url.includes('/search') ? { activeChain: 'dogecoin', groups: [] } : capabilityRow(url)); } } as unknown as HttpClient, state, ownerKeyStub as never);
    expect(service.chainNetwork('bitcoin')).toBe('signet');
    expect(service.chainNetwork('dogecoin')).toBe('testnet');
    expect(service.chainNetwork('zcash')).toBe('mainnet');
    service.getChains$().subscribe();
    service.getChainStatus$('dogecoin').subscribe();
    service.getChainStatus$('zcash').subscribe();
    service.getChainDashboard$('dogecoin').subscribe();
    service.getChainMempool$('dogecoin', 10).subscribe();
    service.getChainCandidateBuckets$('dogecoin').subscribe();
    service.getChainRecentBlocks$('dogecoin', 5).subscribe();
    service.getChainFees$('dogecoin').subscribe();
    service.getChainFees$('zcash').subscribe();
    service.getChainTransaction$('dogecoin', 'a'.repeat(64)).subscribe();
    service.getChainProtocols$('dogecoin').subscribe();
    service.getChainProtocolList$('dogecoin', 'drc20', 25, 0).subscribe();
    service.getChainProtocolDetail$('dogecoin', 'drc20', 'tick').subscribe();
    service.getChainProtocolSection$('dogecoin', 'drc20', 'tick', 'holders', 25, 0).subscribe();
    service.getChainProtocolDetail$('zcash', 'zrc20', 'tick').subscribe();
    service.search$('abc', 'dogecoin', false).subscribe();
    service.getSources$('dogecoin').subscribe();
    expect(urls).toEqual([
      '/api/v1/chains/bitcoin?network=signet',
      '/api/v1/chains/dogecoin?network=testnet',
      '/api/v1/chains/zcash?network=mainnet',
      '/api/v1/dogecoin/status?network=testnet',
      '/api/v1/zcash/status?network=mainnet',
      '/api/v1/dogecoin/dashboard?network=testnet',
      '/api/v1/dogecoin/mempool?network=testnet&limit=10',
      '/api/v1/dogecoin/candidate-buckets?network=testnet',
      '/api/v1/dogecoin/blocks/recent?network=testnet&limit=5',
      '/api/v1/dogecoin/fees?network=testnet',
      '/api/v1/zcash/fees?network=mainnet',
      '/api/v1/dogecoin/tx/' + 'a'.repeat(64) + '?network=testnet',
      '/api/v1/dogecoin/protocols?network=testnet',
      '/api/v1/dogecoin/protocols/drc20?network=testnet&limit=25&cursor=0',
      '/api/v1/dogecoin/protocols/drc20/tick?network=testnet',
      '/api/v1/dogecoin/protocols/drc20/tick/holders?network=testnet&limit=25&cursor=0',
      '/api/v1/zcash/protocols/zrc20/tick?network=mainnet',
      '/api/v1/universe/search?q=abc&chain=dogecoin&all=false&network=testnet',
      '/api/v1/universe/sources?chain=dogecoin&network=testnet',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts the map as a JSON string, the shape a Docker environment value takes', () => {
    const { service, urls } = build(true, undefined, '{"zcash":"testnet"}');
    service.getChainFees$('zcash').subscribe();
    service.getChainFees$('dogecoin').subscribe();
    expect(urls).toEqual(['/api/v1/zcash/fees?network=testnet', '/api/v1/dogecoin/fees?network=mainnet']);
  });

  it.each([
    { dogecoin: 'signet' }, { dogecoin: 'Testnet' }, { dogecoin: 7 }, 'not json', ['testnet'], { bitcoin: 'testnet' }, { doge: 'testnet' },
  ])('sends no Dogecoin request for the invalid configuration %j and fails with the typed reason', (value) => {
    const { service, urls } = build(true, undefined, value);
    const failures: unknown[] = [];
    const reads = [
      service.getChainDashboard$('dogecoin'), service.getChainMempool$('dogecoin', 10), service.getChainCandidateBuckets$('dogecoin'),
      service.getChainRecentBlocks$('dogecoin'), service.getChainFees$('dogecoin'), service.getChainMining$('dogecoin'),
      service.getChainMiningPools$('dogecoin'), service.getChainChartSeries$('dogecoin', 'block-fees'),
      service.getChainTransaction$('dogecoin', 'a'.repeat(64)), service.getChainBlock$('dogecoin', '1'),
      service.getChainAddress$('dogecoin', 'D'), service.getChainAddressHoldings$('dogecoin', 'D'),
      service.getChainOutpoint$('dogecoin', 'a'.repeat(64), '0'), service.getChainProtocols$('dogecoin'),
      service.getChainProtocolList$('dogecoin', 'drc20'), service.getChainProtocolDetail$('dogecoin', 'drc20', 'tick'),
      service.getChainProtocolSection$('dogecoin', 'drc20', 'tick', 'holders'), service.getChainStatus$('dogecoin'),
      service.getSources$('dogecoin'), service.search$('abc', 'dogecoin'),
    ];
    for (const read of reads) {read.subscribe({ error: (error) => failures.push(error) });}
    expect(urls).toEqual([]);
    expect(failures).toHaveLength(reads.length);
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(ChainNetworkUnavailableError);
      expect((failure as ChainNetworkUnavailableError).reason).toContain('UNIVERSE_CHAIN_NETWORKS');
    }
    expect(service.chainNetworkLabel('dogecoin')).toBeNull();
    expect(service.chainNetwork('bitcoin')).toBe('mainnet');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('leaves an invalid chain out of the picker read and keeps the other chains on their own network', () => {
    const { service, urls } = build(true, undefined, { dogecoin: 'signet' });
    let rows: unknown[] = [];
    service.getChains$().subscribe(value => rows = value);
    expect(urls).toEqual(['/api/v1/chains/bitcoin?network=mainnet', '/api/v1/chains/zcash?network=mainnet']);
    expect(rows).toEqual([{ chain: 'bitcoin', network: 'mainnet' }, { chain: 'zcash', network: 'mainnet' }]);
  });

  it('resolves the network again on retry, so a corrected setting is read without a stale substitute', () => {
    const state = { isBrowser: true, network: '', env: { UNIVERSE_CHAIN_NETWORKS: '{"dogecoin":' } } as unknown as StateService;
    const urls: string[] = [];
    const service = new UniverseApiService({ get: (url: string) => { urls.push(url); return of({}); } } as unknown as HttpClient, state, ownerKeyStub as never);
    const read = service.getChainFees$('dogecoin');
    let failure: unknown;
    read.subscribe({ error: (error) => failure = error });
    expect(failure).toBeInstanceOf(ChainNetworkUnavailableError);
    expect(urls).toEqual([]);
    (state.env as Record<string, unknown>).UNIVERSE_CHAIN_NETWORKS = '{"dogecoin":"testnet"}';
    read.subscribe();
    expect(urls).toEqual(['/api/v1/dogecoin/fees?network=testnet']);
  });

  it('never lets a mainnet capability record stand in for a configured testnet scope', () => {
    const state = { isBrowser: true, env: { UNIVERSE_CHAIN_NETWORKS: { dogecoin: 'testnet' } }, network: '' } as unknown as StateService;
    const service = new UniverseApiService({ get: (url: string) => of(url.includes('dogecoin')
      ? { chain: 'dogecoin', network: 'mainnet', ready: true }
      : capabilityRow(url)) } as unknown as HttpClient, state, ownerKeyStub as never);
    let failure: Error | undefined;
    service.getChains$().subscribe({ error: error => failure = error });
    expect(failure?.message).toBe('authority-network-mismatch');
  });

  it('passes the typed unavailable record for a configured scope through under its own network', () => {
    const state = { isBrowser: true, env: { UNIVERSE_CHAIN_NETWORKS: { dogecoin: 'testnet' } }, network: '' } as unknown as StateService;
    const unavailable = { chain: 'dogecoin', network: 'testnet', ready: false, sync: { state: 'unavailable' } };
    const service = new UniverseApiService({ get: (url: string) => of(url.includes('dogecoin') ? unavailable : capabilityRow(url)) } as unknown as HttpClient, state, ownerKeyStub as never);
    let rows: unknown[] = [];
    service.getChains$().subscribe(value => rows = value);
    expect(rows).toEqual([{ chain: 'bitcoin', network: 'mainnet' }, unavailable, { chain: 'zcash', network: 'mainnet' }]);
  });

  it('does not re-read Dogecoin when only the Bitcoin selector changes', () => {
    const changed = new BehaviorSubject('');
    const state = { isBrowser: true, env: { UNIVERSE_CHAIN_NETWORKS: { dogecoin: 'testnet' } }, network: '', networkChanged$: changed } as unknown as StateService;
    const urls: string[] = [];
    const service = new UniverseApiService({ get: (url: string) => { urls.push(url); return of({ chain: 'dogecoin', network: 'testnet' }); } } as unknown as HttpClient, state, ownerKeyStub as never);
    const subscription = service.getChainStatus$('dogecoin').subscribe();
    state.network = 'signet'; changed.next('signet');
    expect(urls).toEqual(['/api/v1/dogecoin/status?network=testnet']);
    subscription.unsubscribe();
  });
});

function capabilityRow(url: string): unknown {
  const match = /\/api\/v1\/chains\/([a-z]+)\?network=([a-z0-9]+)/.exec(url);
  return match ? { chain: match[1], network: match[2] } : {};
}

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
    const service = new UniverseApiService(httpClient, stateService, ownerKeyStub as never);
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
    const service = new UniverseApiService(httpClient, stateService, ownerKeyStub as never);

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
    const service = new UniverseApiService(httpClient, stateService, ownerKeyStub as never);
    const txid = 'b'.repeat(64);
    service.getTransactionFlow$(txid).subscribe();
    service.getTransactionFlow$(txid).subscribe();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('UniverseApiService backend route network prefix', () => {
  function buildOn(network: string): Recorder {
    const urls: string[] = [];
    const httpClient = { get: (url: string) => { urls.push(url); return of({ assets: [], groups: [], offers: [], quotes: [], total: 0 }); }, post: (url: string) => { urls.push(url); return of({}); } } as unknown as HttpClient;
    const stateService = { isBrowser: true, network, env: { ROOT_NETWORK: 'mainnet' } } as unknown as StateService;
    return { service: new UniverseApiService(httpClient, stateService, ownerKeyStub as never), urls };
  }

  it('sends backend-owned routes to the selected network backend, as the gateway expects', () => {
    const { service, urls } = buildOn('signet');
    service.getTaprootAssets$().subscribe();
    service.getTaprootAssetGroups$().subscribe();
    service.getBolt12Offers$().subscribe();
    service.getLightningRfq$().subscribe();
    service.getTaprootAsset$('ab'.repeat(32)).subscribe();
    expect(urls).toEqual([
      '/signet/api/v1/taproot-assets/assets',
      '/signet/api/v1/taproot-assets/groups',
      '/signet/api/v1/lightning/offers',
      '/signet/api/v1/lightning/rfq',
      '/signet/api/v1/taproot-assets/assets/' + 'ab'.repeat(32),
    ]);
  });

  it.each(['', 'mainnet'])('keeps the root backend for the root network %j', network => {
    const { service, urls } = buildOn(network);
    service.getTaprootAssets$().subscribe();
    expect(urls).toEqual(['/api/v1/taproot-assets/assets']);
  });

  /**
   * FE-D04: the propagation read alone was built on the root base, so a
   * Signet reader's observatory asked the root backend for propagation while
   * its nodes and templates came from Signet. All three reads now resolve to
   * the same partition, with the txid still encoded.
   */
  it.each(['signet', 'testnet4'])('sends every observatory read, propagation included, to the %s backend', network => {
    const { service, urls } = buildOn(network);
    service.getObserverNodes$().subscribe();
    service.getPropagationObservation$().subscribe();
    service.getPropagationObservation$('ab/cd?e').subscribe();
    service.getBlockTemplateComparison$().subscribe();
    expect(urls).toEqual([
      '/' + network + '/api/v1/network/nodes',
      '/' + network + '/api/v1/network/propagation',
      '/' + network + '/api/v1/network/propagation/ab%2Fcd%3Fe',
      '/' + network + '/api/v1/network/templates',
    ]);
  });

  it.each(['', 'mainnet'])('keeps the observatory on the root backend for the root network %j', network => {
    const { service, urls } = buildOn(network);
    service.getObserverNodes$().subscribe();
    service.getPropagationObservation$().subscribe();
    service.getPropagationObservation$('a'.repeat(64)).subscribe();
    service.getBlockTemplateComparison$().subscribe();
    expect(urls).toEqual([
      '/api/v1/network/nodes',
      '/api/v1/network/propagation',
      '/api/v1/network/propagation/' + 'a'.repeat(64),
      '/api/v1/network/templates',
    ]);
  });

  it('treats the configured ROOT_NETWORK as the root partition for the observatory', () => {
    const urls: string[] = [];
    const httpClient = { get: (url: string) => { urls.push(url); return of({}); } } as unknown as HttpClient;
    const stateService = { isBrowser: true, network: 'signet', env: { ROOT_NETWORK: 'signet' } } as unknown as StateService;
    const service = new UniverseApiService(httpClient, stateService, ownerKeyStub as never);
    service.getPropagationObservation$().subscribe();
    service.getObserverNodes$().subscribe();
    expect(urls).toEqual(['/api/v1/network/propagation', '/api/v1/network/nodes']);
  });

  it('addresses the observatory through the gateway during server-side rendering', () => {
    const urls: string[] = [];
    const httpClient = { get: (url: string) => { urls.push(url); return of({}); } } as unknown as HttpClient;
    const stateService = {
      isBrowser: false,
      network: 'signet',
      env: { NGINX_PROTOCOL: 'https', NGINX_HOSTNAME: 'explorer.internal', NGINX_PORT: '443', ROOT_NETWORK: 'mainnet' },
    } as unknown as StateService;
    const service = new UniverseApiService(httpClient, stateService, ownerKeyStub as never);
    service.getPropagationObservation$('a'.repeat(64)).subscribe();
    service.getObserverNodes$().subscribe();
    expect(urls).toEqual([
      'https://explorer.internal:443/signet/api/v1/network/propagation/' + 'a'.repeat(64),
      'https://explorer.internal:443/signet/api/v1/network/nodes',
    ]);
  });

  it('does not fall back to the root backend when the Signet propagation read fails', () => {
    const urls: string[] = [];
    const httpClient = { get: (url: string) => { urls.push(url); return throwError(() => ({ status: 503 })); } } as unknown as HttpClient;
    const stateService = { isBrowser: true, network: 'signet', env: { ROOT_NETWORK: 'mainnet' } } as unknown as StateService;
    const service = new UniverseApiService(httpClient, stateService, ownerKeyStub as never);
    let failure: unknown;
    service.getPropagationObservation$().subscribe({ error: error => failure = error });
    expect(failure).toEqual({ status: 503 });
    expect(urls).toEqual(['/signet/api/v1/network/propagation']);
  });
});
