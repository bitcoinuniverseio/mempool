import { describe, expect, it, vi } from 'vitest';
import { Observable, of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '@app/universe/universe-api.service';

interface Recorder {
  service: UniverseApiService;
  urls: string[];
}

function build(
  isBrowser: boolean,
  respond: (url: string) => Observable<unknown> = () => of({}),
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
  it('stays same-origin in the browser', () => {
    const { service, urls } = build(true);
    service.getProtocols$().subscribe();
    service.getStatus$().subscribe();
    service.getSources$().subscribe();
    service.getBackendInfo$().subscribe();
    service.getTransactionFlow$('a'.repeat(64)).subscribe();
    expect(urls).toEqual([
      '/api/v1/universe/protocols',
      '/api/v1/universe/status',
      '/api/v1/universe/sources',
      '/api/v1/backend-info',
      '/api/v1/universe/transactions/' + 'a'.repeat(64),
    ]);
  });

  it('addresses the gateway explicitly during server-side rendering', () => {
    const { service, urls } = build(false);
    service.getProtocols$().subscribe();
    service.getBackendInfo$().subscribe();
    expect(urls).toEqual([
      'https://explorer.internal:443/api/v1/universe/protocols',
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
      '/api/v1/universe/search?q=tick%20%26%20rune&chain=zcash&all=true',
    ]);
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
