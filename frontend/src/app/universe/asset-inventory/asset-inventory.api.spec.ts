import { describe, expect, it } from 'vitest';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { AssetInventory } from './asset-inventory.types';
import { ADDRESS, BLOCK_HASH, TXID, inventory, pageOf } from './asset-inventory.test-fixtures';

function build(respond: (url: string) => Observable<unknown>) {
  const urls: string[] = [];
  const networkChanged$ = new BehaviorSubject<string>('mainnet');
  const state = { isBrowser: true, network: 'mainnet', env: { ROOT_NETWORK: 'mainnet' }, networkChanged$ };
  const http = { get: (url: string) => { urls.push(url); return respond(url); } } as unknown as HttpClient;
  const service = new UniverseApiService(http, state as unknown as StateService, { headers: () => ({}), key: null } as never);
  const switchTo = (network: string): void => {
    state.network = network;
    networkChanged$.next(network);
  };
  return { service, urls, switchTo };
}

describe('UniverseApiService.getAssetInventory$', () => {
  it('reads the three public routes under the same-origin Universe base with chain and network', () => {
    const { service, urls } = build((url) => of(url.includes('/transactions/') ? inventory('transaction')
      : url.includes('/blocks/') ? pageOf('block', 0, 2, 25) : pageOf('address', 0, 1, 100)));
    service.getAssetInventory$('transaction', TXID).subscribe();
    service.getAssetInventory$('block', BLOCK_HASH).subscribe();
    service.getAssetInventory$('address', ADDRESS).subscribe();
    expect(urls).toEqual([
      `/api/v1/universe/inventory/transactions/${TXID}?chain=bitcoin&network=mainnet`,
      `/api/v1/universe/inventory/blocks/${BLOCK_HASH}?chain=bitcoin&network=mainnet`,
      `/api/v1/universe/inventory/addresses/${ADDRESS}?chain=bitcoin&network=mainnet`,
    ]);
  });

  it('encodes an opaque cursor and validates that the page echoes it', () => {
    const cursor = 'eyJ2IjoxfQ.a+b/c=';
    const { service, urls } = build(() => of({ ...pageOf('block', 1, 3, 25), page: { ...pageOf('block', 1, 3, 25).page, cursor } }));
    let page: AssetInventory | null = null;
    service.getAssetInventory$('block', BLOCK_HASH, { cursor, network: 'mainnet' }).subscribe((value) => page = value);
    expect(urls[0]).toBe(`/api/v1/universe/inventory/blocks/${BLOCK_HASH}?cursor=${encodeURIComponent(cursor)}&chain=bitcoin&network=mainnet`);
    expect(page!.page?.cursor).toBe(cursor);
  });

  it('rejects a response for another network or key instead of rendering it', () => {
    const failures: unknown[] = [];
    build(() => of(inventory('transaction', { scope: { network: 'signet' } })))
      .service.getAssetInventory$('transaction', TXID).subscribe({ error: (error) => failures.push(error) });
    build(() => of(inventory('transaction', { scope: { key: 'f'.repeat(64) } })))
      .service.getAssetInventory$('transaction', TXID).subscribe({ error: (error) => failures.push(error) });
    expect(failures.map(String)).toEqual([
      'AssetInventoryContractError: asset-inventory-scope-network',
      'AssetInventoryContractError: asset-inventory-scope-key',
    ]);
  });

  it('cancels the request in flight when the selected network changes', () => {
    const pending = new Subject<unknown>();
    const { service, urls, switchTo } = build((url) => url.endsWith('network=mainnet') ? pending : of(inventory('transaction', { scope: { network: 'signet' } })));
    const seen: AssetInventory[] = [];
    service.getAssetInventory$('transaction', TXID).subscribe((value) => seen.push(value));
    switchTo('signet');
    expect(pending.observed).toBe(false);
    pending.next(inventory('transaction'));
    expect(urls.map((url) => url.split('network=')[1])).toEqual(['mainnet', 'signet']);
    expect(seen.map((value) => value.scope.network)).toEqual(['signet']);
  });

  it('refuses a later page once the selection moved off the walk network', () => {
    const { service, urls, switchTo } = build(() => of(pageOf('block', 1, 2, 25)));
    switchTo('signet');
    let failure: unknown = null;
    service.getAssetInventory$('block', BLOCK_HASH, { cursor: 'cursor-1', network: 'mainnet' }).subscribe({ error: (error) => failure = error });
    expect(String(failure)).toContain('asset-request-context-changed');
    expect(urls).toEqual([]);
  });
});
