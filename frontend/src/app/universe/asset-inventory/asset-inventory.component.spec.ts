import { describe, expect, it } from 'vitest';
import { SimpleChange } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { AssetInventory, InventoryScopeKind, decodeAssetInventory } from './asset-inventory.types';
import { AssetInventoryComponent, INVENTORY_AUTO_PAGES, INVENTORY_MAX_RESTARTS } from './asset-inventory.component';
import {
  ADDRESS,
  BLOCK_HASH,
  OTHER_HASH,
  TXID,
  Wire,
  allCoverage,
  fungibleAsset,
  inscriptionAsset,
  inventory,
  pageOf,
} from './asset-inventory.test-fixtures';

interface Call {
  kind: InventoryScopeKind;
  key: string;
  cursor: string | null;
  network: string;
}

type Answer = Wire | HttpErrorResponse | Observable<AssetInventory>;

/** A service double that decodes wire payloads exactly as the real one does. */
function harness(answer: (call: Call, index: number) => Answer) {
  const network$ = new BehaviorSubject<string>('mainnet');
  const calls: Call[] = [];
  const api = {
    chainNetwork$: () => network$.asObservable(),
    getProtocols$: () => of({ protocols: [] }),
    getAssetInventory$: (kind: InventoryScopeKind, key: string, options: { cursor?: string | null; network?: string }) => {
      const call: Call = { kind, key, cursor: options.cursor ?? null, network: options.network ?? '' };
      calls.push(call);
      const result = answer(call, calls.length - 1);
      if (result instanceof HttpErrorResponse) {return throwError(() => result);}
      if (result instanceof Observable) {return result;}
      try {
        return of(decodeAssetInventory(result, { kind, chain: 'bitcoin', network: call.network, key }, call.cursor));
      } catch (error) {
        return throwError(() => error);
      }
    },
  } as unknown as UniverseApiService;
  const component = new AssetInventoryComponent(api, { markForCheck: () => undefined } as never);
  return { component, calls, network$ };
}

function open(component: AssetInventoryComponent, scope: InventoryScopeKind, key: string, revision: unknown = null): void {
  component.scope = scope;
  component.key = key;
  component.revision = revision;
  component.ngOnChanges({ key: new SimpleChange(null, key, true) });
}

function http(status: number, error: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { error } });
}

/** A block walk page whose transactions each carry one distinct inscription. */
function blockPage(index: number, pages: number, body: Wire = {}): Wire {
  const asset = inscriptionAsset('9'.repeat(63) + String(index % 10) + 'i' + index);
  return pageOf('block', index, pages, 25, {
    assets: [asset],
    groups: [{ protocolId: 'ordinals', subprotocolId: null, assetKeys: [asset.key], eventCount: 0 }],
    ...body,
  });
}

function cursorIndex(cursor: string | null): number {
  return cursor === null ? 0 : Number(cursor.slice('cursor-'.length));
}

describe('AssetInventoryComponent block walk', () => {
  it('walks every cursor page of a block bound to its hash', () => {
    const { component, calls } = harness((call) => blockPage(cursorIndex(call.cursor), 3));
    open(component, 'block', BLOCK_HASH);
    expect(calls.map((call) => call.cursor)).toEqual([null, 'cursor-1', 'cursor-2']);
    expect(calls.every((call) => call.key === BLOCK_HASH && call.network === 'mainnet')).toBe(true);
    expect(component.state.phase).toBe('ready');
    expect(component.state.model?.distinctAssets).toBe(3);
    expect(component.state.model?.complete).toBe(true);
    expect(component.state.hasMore).toBe(false);
  });

  it('restarts from page one when the producer answers 409 cursor-stale', () => {
    let staled = false;
    const { component, calls } = harness((call) => {
      if (call.cursor === 'cursor-1' && !staled) {
        staled = true;
        return http(409, 'cursor-stale');
      }
      return blockPage(cursorIndex(call.cursor), 2);
    });
    open(component, 'block', BLOCK_HASH);
    expect(calls.map((call) => call.cursor)).toEqual([null, 'cursor-1', null, 'cursor-1']);
    expect(component.state.phase).toBe('ready');
    expect(component.state.restarts).toBe(1);
    expect(component.state.model?.distinctAssets).toBe(2);
    expect(component.state.model?.complete).toBe(true);
  });

  it('rejects a page from another snapshot, restarts, and gives up after a bounded number of tries', () => {
    const { component, calls } = harness((call) => cursorIndex(call.cursor) === 1
      ? blockPage(1, 2, { checkpoints: [{ sourceId: 'ord', heightAtomic: '900001', blockHash: OTHER_HASH, generation: null }] })
      : blockPage(0, 2));
    open(component, 'block', BLOCK_HASH);
    expect(calls.filter((call) => call.cursor === null)).toHaveLength(INVENTORY_MAX_RESTARTS + 1);
    expect(component.state.phase).toBe('error');
    expect(component.state.error).toBe('stale');
    expect(component.state.model).toBeNull();
  });

  it('rejects a page whose scope block hash differs from the requested block', () => {
    const { component } = harness((call) => blockPage(cursorIndex(call.cursor), 2, cursorIndex(call.cursor) === 1
      ? { scope: { blockHash: OTHER_HASH } } : {}));
    open(component, 'block', BLOCK_HASH);
    // The foreign page is refused and never merged; page one stays, marked incomplete.
    expect(component.state.pageError).toBe('invalid');
    expect(component.state.model?.distinctAssets).toBe(1);
    expect(component.state.model?.complete).toBe(false);
  });

  it('pauses after a bounded run of pages, continues on request and can be stopped', () => {
    const pages = INVENTORY_AUTO_PAGES + 5;
    const pending = new Subject<AssetInventory>();
    let hold = false;
    const { component, calls } = harness((call) => hold && cursorIndex(call.cursor) === INVENTORY_AUTO_PAGES + 1
      ? pending.asObservable()
      : blockPage(cursorIndex(call.cursor), pages));
    open(component, 'block', BLOCK_HASH);
    expect(calls).toHaveLength(INVENTORY_AUTO_PAGES);
    expect(component.state.hasMore).toBe(true);
    expect(component.state.loadingMore).toBe(false);
    expect(component.state.model?.complete).toBe(false);
    expect(component.state.model?.coverage.every((row) => row.state !== 'complete')).toBe(true);

    hold = true;
    component.loadMore();
    expect(component.state.loadingMore).toBe(true);
    component.stop();
    expect(component.state.loadingMore).toBe(false);
    expect(component.state.hasMore).toBe(true);
    expect(pending.observed).toBe(false);

    hold = false;
    component.loadMore();
    expect(calls.map((call) => call.cursor).slice(-1)[0]).toBe('cursor-' + (pages - 1));
    expect(component.state.model?.distinctAssets).toBe(pages);
    expect(component.state.model?.complete).toBe(true);
  });

  it('keeps what was read when a later page fails and retries from that cursor', () => {
    let fail = true;
    const { component, calls } = harness((call) => {
      if (cursorIndex(call.cursor) === 1 && fail) {
        fail = false;
        return http(502, 'bitcoin-authority-unavailable');
      }
      return blockPage(cursorIndex(call.cursor), 2);
    });
    open(component, 'block', BLOCK_HASH);
    expect(component.state.pageError).toBe('unavailable');
    expect(component.state.model?.distinctAssets).toBe(1);
    expect(component.state.model?.complete).toBe(false);
    component.retry();
    expect(calls.map((call) => call.cursor)).toEqual([null, 'cursor-1', 'cursor-1']);
    expect(component.state.model?.complete).toBe(true);
  });
});

describe('AssetInventoryComponent address holdings', () => {
  it('shows ledger balances for an address with no unspent outputs', () => {
    const ordi = fungibleAsset('brc20', 'ordi', 18, 'ordi');
    const { component, calls } = harness(() => inventory('address', {
      assets: [ordi],
      groups: [{ protocolId: 'brc20', subprotocolId: null, assetKeys: [ordi.key], eventCount: 0 }],
      balances: [{ assetKey: ordi.key, overallAtomic: '12000000000000000000', availableAtomic: '10000000000000000000', reservedAtomic: '2000000000000000000', outpoints: [] }],
      page: { cursor: null, nextCursor: null, fromIndex: 0, toIndex: 0, totalItems: 0 },
    }));
    open(component, 'address', ADDRESS);
    expect(calls).toHaveLength(1);
    const row = component.state.model!.sections[0].subgroups[0].assets[0];
    expect(row.balance?.overall.exact).toBe('12');
    expect(row.balance?.available?.exact).toBe('10');
    expect(row.balance?.reserved?.exact).toBe('2');
    expect(component.state.model?.complete).toBe(true);
    expect(component.state.model?.totalItems).toBe(0);
  });

  it('reads every output page of an address with more than 500 outputs', () => {
    const pages = 6;
    const { component, calls } = harness((call) => {
      const index = cursorIndex(call.cursor);
      const asset = inscriptionAsset('8'.repeat(63) + String(index) + 'i0');
      return pageOf('address', index, pages, 100, {
        assets: [asset],
        groups: [{ protocolId: 'ordinals', subprotocolId: null, assetKeys: [asset.key], eventCount: 0 }],
      });
    });
    open(component, 'address', ADDRESS);
    expect(calls).toHaveLength(pages);
    expect(component.state.model?.totalItems).toBe(600);
    expect(component.state.model?.loadedItems).toBe(600);
    expect(component.state.model?.distinctAssets).toBe(pages);
    expect(component.state.model?.complete).toBe(true);
  });

  it('reports a wrong-network address instead of an empty inventory', () => {
    const { component } = harness(() => http(400, 'wrong-network'));
    open(component, 'address', ADDRESS);
    expect(component.state.error).toBe('wrong-network');
    expect(component.state.model).toBeNull();
  });
});

describe('AssetInventoryComponent transaction lifecycle', () => {
  it('re-reads on a status revision and ignores the late answer for the old revision', () => {
    const first = new Subject<AssetInventory>();
    const { component, calls } = harness((_call, index) => index === 0 ? first.asObservable() : inventory('transaction'));
    open(component, 'transaction', TXID, 'unconfirmed');
    expect(component.state.phase).toBe('loading');
    component.revision = BLOCK_HASH;
    component.ngOnChanges({ revision: new SimpleChange('unconfirmed', BLOCK_HASH, false) });
    expect(calls).toHaveLength(2);
    expect(component.state.phase).toBe('ready');
    first.next(decodeAssetInventory(inventory('transaction', {
      coverage: allCoverage({ ordinals: ['partial', ['pending']] }),
    }), { kind: 'transaction', chain: 'bitcoin', network: 'mainnet', key: TXID }));
    expect(component.state.model?.complete).toBe(true);
  });

  it('starts again under a new network', () => {
    const { component, calls, network$ } = harness(() => inventory('transaction'));
    open(component, 'transaction', TXID);
    network$.next('signet');
    expect(calls.map((call) => call.network)).toEqual(['mainnet', 'signet']);
    expect(component.state.phase).toBe('error');
    expect(component.state.error).toBe('invalid');
  });

  it.each([
    [503, 'bitcoin-authority-unconfigured', 'unconfigured'],
    [502, 'bitcoin-authority-unavailable', 'unavailable'],
    [404, 'not-found', 'not-found'],
  ])('maps HTTP %s to %s', (status, error, expected) => {
    const { component } = harness(() => http(status, error));
    open(component, 'transaction', TXID);
    expect(component.state.phase).toBe('error');
    expect(component.state.error).toBe(expected);
  });

  it('stays out of the way on a network the overlay does not serve', () => {
    const { component } = harness(() => inventory('transaction'));
    (component as unknown as { api: { chainNetwork$: () => Observable<string> } }).api.chainNetwork$ =
      () => throwError(() => new Error('unsupported-overlay-network'));
    open(component, 'transaction', TXID);
    expect(component.state.phase).toBe('idle');
  });
});
