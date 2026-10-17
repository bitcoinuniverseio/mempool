// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChangeDetectorRef, SimpleChange, ɵresolveComponentResources as resolveComponentResources } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { of } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { AssetInventoryComponent } from './asset-inventory.component';
import { InventoryScopeKind, decodeAssetInventory } from './asset-inventory.types';
import {
  ADDRESS,
  TXID,
  Wire,
  allCoverage,
  fungibleAsset,
  inscriptionAsset,
  inventory,
} from './asset-inventory.test-fixtures';

beforeAll(async () => {
  Object.defineProperty(AssetInventoryComponent, 'ctorParameters', {
    configurable: true,
    value: () => [{ type: UniverseApiService }, { type: ChangeDetectorRef }],
  });
  const here = dirname(fileURLToPath(import.meta.url));
  const dirs = ['.', '../protocol-badge', '../asset-flow', '../transaction-assets'].map((dir) => resolve(here, dir));
  await resolveComponentResources((url: string) => {
    if (url.endsWith('.scss') || url.endsWith('.css')) {
      return Promise.resolve({ text: () => Promise.resolve('') } as Response);
    }
    const file = dirs.map((dir) => resolve(dir, url)).find((candidate) => existsSync(candidate));
    return Promise.resolve({ text: () => Promise.resolve(readFileSync(file, 'utf8')) } as Response);
  });
  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

afterEach(() => TestBed.resetTestingModule());

function render(scope: InventoryScopeKind, key: string, body: Wire): HTMLElement {
  const api = {
    chainNetwork$: () => of('mainnet'),
    getProtocols$: () => of({ protocols: [{ id: 'brc20', displayName: 'BRC-20' }] }),
    getAssetInventory$: () => of(decodeAssetInventory(body, { kind: scope, chain: 'bitcoin', network: 'mainnet', key })),
  };
  TestBed.configureTestingModule({
    imports: [AssetInventoryComponent],
    providers: [provideRouter([]), { provide: UniverseApiService, useValue: api }],
  });
  const view = TestBed.createComponent(AssetInventoryComponent);
  view.componentInstance.scope = scope;
  view.componentInstance.key = key;
  view.componentInstance.ngOnChanges({ key: new SimpleChange(null, key, true) });
  view.detectChanges();
  return view.nativeElement as HTMLElement;
}

describe('asset inventory template', () => {
  it('renders protocol sections, classifications, applied events and observations', () => {
    const ordi = fungibleAsset('brc20', 'ordi', 18, 'ordi');
    const inscription = inscriptionAsset(undefined, [{
      protocolId: 'brc20', subprotocolId: null, kind: 'fungible', label: 'ordi', amountAtomic: '1000000000000000000000',
      decimals: 18, unit: 'ordi', relation: 'transferable', assetKey: ordi.key,
    }]);
    const event = (eventId: string, accepted: boolean) => ({
      eventId, sourceId: 'index-brc20', protocolId: 'brc20', subprotocolId: null, txid: TXID, txIndex: 1, operation: 'transfer',
      accepted, reason: accepted ? null : 'insufficient-balance', assetKey: ordi.key, amountAtomic: '2500000000000000000',
      fromAddress: null, fromOutpoint: null, toAddress: null, toOutpoint: null, inscriptionId: null, blockEffect: !accepted ? false : true,
    });
    const element = render('transaction', TXID, inventory('transaction', {
      coverage: allCoverage({ names: ['unconfigured', ['no-reader']] }),
      assets: [inscription, ordi],
      groups: [
        { protocolId: 'ordinals', subprotocolId: null, assetKeys: [inscription.key], eventCount: 0 },
        { protocolId: 'brc20', subprotocolId: null, assetKeys: [inscription.key, ordi.key], eventCount: 2 },
      ],
      placements: [{ assetKey: inscription.key, txid: TXID, side: 'output', index: 0, outpoint: TXID + ':0', amountAtomic: '1', offsetAtomic: '0' }],
      events: [event('a', true), event('b', false)],
    }));
    const text = element.textContent ?? '';
    expect(text).toContain('Asset inventory');
    expect(text).toContain('2 distinct assets found so far, not complete');
    expect(element.querySelectorAll('section.protocol-section').length).toBe(2);
    expect(text).toContain('BRC-20');
    expect(text).toContain('1,000 ordi');
    expect(text).toContain('Applied events');
    expect(text).toContain('Observations (not applied, never counted)');
    expect(text).toContain('Block effect');
    expect(text).toContain('2.5 ordi');
    expect(text).toContain('Unknown, not proven empty');
    expect(element.querySelector(`a[href="/inscription/${inscription.nativeId}"]`)).not.toBeNull();
    expect(element.querySelector('button.refresh')?.textContent).toContain('Retry');
  });

  it('renders overall, available and reserved separately for an address ledger', () => {
    const ordi = fungibleAsset('brc20', 'ordi', 18, 'ordi');
    const element = render('address', ADDRESS, inventory('address', {
      assets: [ordi],
      groups: [{ protocolId: 'brc20', subprotocolId: null, assetKeys: [ordi.key], eventCount: 0 }],
      balances: [{ assetKey: ordi.key, overallAtomic: '5000000000000000000', availableAtomic: '4000000000000000000', reservedAtomic: '1000000000000000000', outpoints: [] }],
      page: { cursor: null, nextCursor: null, fromIndex: 0, toIndex: 0, totalItems: 0 },
    }));
    const amounts = [...element.querySelectorAll('dl.amounts div')]
      .map((row) => [...row.children].map((cell) => cell.textContent?.trim()).join(' '));
    expect(amounts).toEqual(['Overall 5 ordi', 'Available 4 ordi', 'Reserved (part of overall) 1 ordi']);
    expect(element.textContent).toContain('Read 0 of 0 outputs');
    expect(element.textContent).toContain('1 distinct assets, complete');
  });
});
