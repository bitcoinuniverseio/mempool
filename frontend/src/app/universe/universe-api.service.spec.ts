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
  respond: (url: string) => Observable<unknown> = () => of({})
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
      'unsupported-chain-protocol'
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
    const stateService = {
      isBrowser: true,
      env: {},
    } as unknown as StateService;
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
    const stateService = {
      isBrowser: true,
      env: {},
    } as unknown as StateService;
    const service = new UniverseApiService(httpClient, stateService);

    let failed = false;
    service.getProtocols$().subscribe({ error: () => (failed = true) });
    expect(failed).toBe(true);

    let version: string | null = null;
    service
      .getProtocols$()
      .subscribe(
        (response) =>
          (version = (response as { registryVersion: string }).registryVersion)
      );
    expect(version).toBe('1.0.0');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('never caches a transaction flow, whose state changes as it confirms', () => {
    const get = vi.fn(() => of({}));
    const httpClient = { get } as unknown as HttpClient;
    const stateService = {
      isBrowser: true,
      env: {},
    } as unknown as StateService;
    const service = new UniverseApiService(httpClient, stateService);
    const txid = 'b'.repeat(64);
    service.getTransactionFlow$(txid).subscribe();
    service.getTransactionFlow$(txid).subscribe();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('UniverseApiService response contracts', () => {
  it('rejects malformed protocol pages instead of labelling them unsupported', () => {
    const { service } = build(true, () => of({ state: 'served' }));
    const errors: unknown[] = [];

    service
      .getProtocolActivity$('ordinals')
      .subscribe({ error: (error) => errors.push(error) });
    service
      .getProtocolObjects$('ordinals')
      .subscribe({ error: (error) => errors.push(error) });

    expect(errors).toHaveLength(2);
    expect(errors.map(String)).toEqual([
      'Error: malformed-protocol-activity-response',
      'Error: malformed-protocol-objects-response',
    ]);
  });

  it('keeps a real 404 as an explicit unsupported protocol state', () => {
    const { service } = build(true, () => throwError(() => ({ status: 404 })));
    const states: string[] = [];

    service
      .getProtocolActivity$('ordinals')
      .subscribe((page) => states.push(page.state));
    service
      .getProtocolObjects$('ordinals')
      .subscribe((page) => states.push(page.state));

    expect(states).toEqual(['unsupported', 'unsupported']);
  });

  it('rejects malformed product objects, list envelopes, and query results', () => {
    const { service } = build(true, () => of({}));
    const errors: unknown[] = [];

    service
      .getFractalTip$()
      .subscribe({ error: (error) => errors.push(error) });
    service
      .getObserverNodes$()
      .subscribe({ error: (error) => errors.push(error) });
    service
      .executeDataQuery$({ datasetId: 'bitcoin.blocks', limit: 1 })
      .subscribe({ error: (error) => errors.push(error) });

    expect(errors).toHaveLength(3);
    expect(errors.every((error) => String(error).includes('malformed-'))).toBe(
      true
    );
  });

  it('accepts a valid empty list and rejects malformed list members', () => {
    const valid = build(true, () => of({ nodes: [], total: 0 }));
    let nodeCount: number | undefined;
    valid.service.getObserverNodes$().subscribe((response) => {
      nodeCount = response.nodes.length;
    });
    expect(nodeCount).toBe(0);

    const malformed = build(true, () => of({ nodes: [{}], total: 1 }));
    let failed = false;
    malformed.service
      .getObserverNodes$()
      .subscribe({ error: () => (failed = true) });
    expect(failed).toBe(true);
  });

  it('rejects product records missing fields rendered by their views', () => {
    const cat20 = {
      tokenId: 'token-id',
      name: 'Token',
      symbol: 'TKN',
      decimals: 8,
      maxSupplyAtomic: '21000000',
      circulatingSupplyAtomic: '1000',
      mintLimitAtomic: '100',
      deployTxid: 'a'.repeat(64),
      deployHeight: 100,
      minterAddress: 'address',
      minterType: 'open',
      holderCount: 1,
      transferCount: 2,
      state: 'active',
    };
    const taprootAsset = {
      assetId: 'asset-id',
      assetType: 'normal',
      name: 'Asset',
      genesisPoint: `${'b'.repeat(64)}:0`,
      genesisHeight: 200,
      totalAmountAtomic: '500',
      anchorTxid: 'c'.repeat(64),
      anchorOutpoint: `${'c'.repeat(64)}:1`,
      scriptKey: 'script-key',
      hasProofFile: false,
      mintTime: 1_700_000_000,
    };
    const responses: Record<string, unknown> = {
      '/api/v1/fractal/cat20/tokens': {
        tokens: [{ ...cat20, holderCount: undefined }],
        total: 1,
      },
      '/api/v1/fractal/cat20/tokens/token-id': {
        ...cat20,
        minterType: undefined,
      },
      '/api/v1/taproot-assets/assets': {
        assets: [{ ...taprootAsset, totalAmountAtomic: undefined }],
        total: 1,
      },
      '/api/v1/taproot-assets/assets/asset-id': {
        ...taprootAsset,
        genesisHeight: undefined,
      },
    };
    const { service } = build(true, (url) => of(responses[url]));
    const errors: unknown[] = [];

    service
      .getCat20Tokens$()
      .subscribe({ error: (error) => errors.push(error) });
    service
      .getCat20Token$('token-id')
      .subscribe({ error: (error) => errors.push(error) });
    service
      .getTaprootAssets$()
      .subscribe({ error: (error) => errors.push(error) });
    service
      .getTaprootAsset$('asset-id')
      .subscribe({ error: (error) => errors.push(error) });

    expect(errors.map(String)).toEqual([
      'Error: malformed-cat20-tokens-response',
      'Error: malformed-cat20-token-response',
      'Error: malformed-taproot-assets-response',
      'Error: malformed-taproot-asset-response',
    ]);
  });
});
