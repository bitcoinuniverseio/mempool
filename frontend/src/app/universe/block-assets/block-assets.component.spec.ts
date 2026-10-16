// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChangeDetectorRef, SimpleChange, ɵresolveComponentResources as resolveComponentResources } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { Observable, of, throwError } from 'rxjs';
import { BlockAssetsComponent } from './block-assets.component';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  BlockAssetActivitySummary,
  BlockAssetEvent,
  BlockAssetEventQuery,
  BlockAssetEventsPage,
} from '@app/universe/universe.types';

const HASH = 'a'.repeat(64);
const TXID = 'b'.repeat(64);

function summary(overrides: Partial<BlockAssetActivitySummary> = {}): BlockAssetActivitySummary {
  return {
    schemaVersion: 'universe-block-asset-activity-v1',
    chain: 'bitcoin',
    network: 'mainnet',
    block: { heightAtomic: '900000', hash: HASH, canonical: true },
    generatedAt: '2026-10-16T00:00:00.000Z',
    completeness: 'partial',
    progress: { processedTransactionsAtomic: '2', totalTransactionsAtomic: '2' },
    counts: {
      transactionsAtomic: '2',
      assetBearingTransactionsAtomic: '1',
      distinctAssetsAtomic: '1',
      transfersAtomic: '0',
      creationsAtomic: '0',
      burnsAtomic: '0',
      otherOperationsAtomic: '0',
      outputPositionsAtomic: '1',
      protocolsWithActivityAtomic: '1',
    },
    protocols: [
      {
        protocolId: 'runes',
        displayName: 'Runes',
        family: 'fungible',
        releaseStatus: 'VERIFIED READ ONLY',
        state: 'read',
        reason: null,
        authorityId: 'ord',
        negativeCompleteness: true,
        transactionCountAtomic: '1',
        eventCountAtomic: '1',
        checkpoint: null,
      },
      {
        protocolId: 'brc20',
        displayName: 'BRC-20',
        family: 'fungible',
        releaseStatus: 'BLOCKED',
        state: 'not-block-readable',
        reason: null,
        authorityId: null,
        negativeCompleteness: false,
        transactionCountAtomic: '0',
        eventCountAtomic: '0',
        checkpoint: null,
      },
    ],
    outOfCoverageOutputsAtomic: '0',
    unresolvedOutputsAtomic: '0',
    privacy: null,
    retryAfterSeconds: null,
    ...overrides,
  };
}

const EVENT: BlockAssetEvent = {
  eventId: `bitcoin:mainnet:runes:${TXID}:1:position:840000:3`,
  kind: 'output-position',
  txid: TXID,
  txIndex: 1,
  protocolId: 'runes',
  operation: 'present-at-output',
  asset: { protocolId: 'runes', assetId: '840000:3', displayName: 'DOG•GO•TO•THE•MOON', assetKind: 'fungible' },
  quantityAtomic: '123456789012345678901234567890',
  inputOutpoints: [],
  outputOutpoints: [`${TXID}:1`],
  outputAddress: 'bc1qexampleaddress0000000000000000000000',
  inputAddress: null,
  verification: 'verified',
  evidence: { authorityId: 'ord', coverage: 'complete' },
};

function page(items: BlockAssetEvent[], nextCursor: string | null = null): BlockAssetEventsPage {
  return {
    schemaVersion: 'universe-block-asset-events-v1',
    chain: 'bitcoin',
    network: 'mainnet',
    block: { heightAtomic: '900000', hash: HASH },
    completeness: 'partial',
    totalAtomic: String(items.length + (nextCursor ? 1 : 0)),
    items,
    nextCursor,
  };
}

interface FakeApi {
  summaries: Array<() => Observable<BlockAssetActivitySummary>>;
  eventQueries: BlockAssetEventQuery[];
  pages: Array<() => Observable<BlockAssetEventsPage>>;
}

function fakeApi(api: FakeApi): UniverseApiService {
  return {
    getBlockAssetActivity$: () => (api.summaries.length > 1 ? api.summaries.shift() : api.summaries[0])(),
    getBlockAssetEvents$: (_chain: string, _ref: string, query: BlockAssetEventQuery) => {
      api.eventQueries.push(query);
      return (api.pages.length > 1 ? api.pages.shift() : api.pages[0])();
    },
  } as unknown as UniverseApiService;
}

function componentWith(api: FakeApi): BlockAssetsComponent {
  const component = new BlockAssetsComponent(fakeApi(api), { markForCheck: () => undefined } as never);
  component.chain = 'bitcoin';
  component.reference = HASH;
  return component;
}

const referenceChange = { reference: new SimpleChange(null, HASH, true) };

beforeAll(async () => {
  Object.defineProperty(BlockAssetsComponent, 'ctorParameters', {
    configurable: true,
    value: () => [{ type: UniverseApiService }, { type: ChangeDetectorRef }],
  });
  // The real templates, read from disk. The shared module brings the
  // protocol badge and its siblings, each resolved from its own directory.
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

describe('BlockAssetsComponent behaviour', () => {
  afterEach(() => vi.useRealTimers());

  it('polls a snapshot still being built and stops once it settles', () => {
    vi.useFakeTimers();
    const api: FakeApi = {
      summaries: [
        () => of(summary({ completeness: 'pending', retryAfterSeconds: 3 })),
        () => of(summary()),
      ],
      eventQueries: [],
      pages: [() => of(page([EVENT]))],
    };
    const component = componentWith(api);
    component.ngOnChanges(referenceChange);
    expect(component.summary?.completeness).toBe('pending');
    vi.advanceTimersByTime(3000);
    expect(component.summary?.completeness).toBe('partial');
    vi.advanceTimersByTime(30_000);
    // One summary per poll, each followed by a refreshed first page of rows.
    expect(api.eventQueries).toHaveLength(2);
    component.ngOnDestroy();
  });

  it('reports a malformed txid filter without asking the overlay', () => {
    const api: FakeApi = { summaries: [() => of(summary())], eventQueries: [], pages: [() => of(page([EVENT]))] };
    const component = componentWith(api);
    component.ngOnChanges(referenceChange);
    component.txid = 'not-a-txid';
    component.applyFilters();
    expect(component.txidInvalid).toBe(true);
    expect(component.eventsFailed).toBe(false);
    expect(api.eventQueries).toHaveLength(1);
  });

  it('appends the next page through the cursor and passes filters to the server', () => {
    const api: FakeApi = {
      summaries: [() => of(summary())],
      eventQueries: [],
      pages: [() => of(page([EVENT], 'cursor-1')), () => of(page([{ ...EVENT, eventId: 'second' }]))],
    };
    const component = componentWith(api);
    component.ngOnChanges(referenceChange);
    component.loadMore();
    expect(component.events.map((event) => event.eventId)).toEqual([EVENT.eventId, 'second']);
    expect(api.eventQueries[1].cursor).toBe('cursor-1');

    component.group = 'creation';
    component.protocol = 'runes';
    component.applyFilters();
    expect(api.eventQueries[2]).toMatchObject({ group: 'creation', protocol: 'runes', cursor: undefined });
  });

  it('separates an unconfigured deployment from an outage', () => {
    const unconfigured = componentWith({
      summaries: [() => throwError(() => new HttpErrorResponse({ status: 503 }))],
      eventQueries: [],
      pages: [],
    });
    unconfigured.ngOnChanges(referenceChange);
    expect(unconfigured.state).toEqual({ kind: 'error', reason: 'unconfigured' });

    const down = componentWith({
      summaries: [() => throwError(() => new HttpErrorResponse({ status: 502 }))],
      eventQueries: [],
      pages: [],
    });
    down.ngOnChanges(referenceChange);
    expect(down.state).toEqual({ kind: 'error', reason: 'unavailable' });
  });
});

describe('BlockAssetsComponent template', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(value: BlockAssetActivitySummary, items: BlockAssetEvent[] = [EVENT]) {
    TestBed.configureTestingModule({
      imports: [BlockAssetsComponent],
      providers: [
        provideRouter([]),
        {
          provide: UniverseApiService,
          useValue: fakeApi({ summaries: [() => of(value)], eventQueries: [], pages: [() => of(page(items))] }),
        },
      ],
    });
    const view = TestBed.createComponent(BlockAssetsComponent);
    view.componentInstance.chain = 'bitcoin';
    view.componentInstance.reference = HASH;
    view.componentInstance.ngOnChanges(referenceChange);
    view.detectChanges();
    return view;
  }

  it('renders the exact quantity, a real table and the position legend', () => {
    const element = render(summary()).nativeElement as HTMLElement;
    const text = element.textContent ?? '';
    expect(text).toContain('Assets & Protocol Activity');
    expect(text).toContain('123,456,789,012,345,678,901,234,567,890');
    expect(text).toContain('On output');
    expect(element.querySelectorAll('table.activity thead th[scope="col"]').length).toBe(10);
    expect(element.querySelector('a[href="/rune/840000:3"]')).not.toBeNull();
    expect(element.querySelector(`a[href="/tx/${TXID}"]`)).not.toBeNull();
  });

  it('states coverage limits instead of claiming the block is empty', () => {
    const element = render(summary(), []).nativeElement as HTMLElement;
    const text = element.textContent ?? '';
    expect(text).toContain('cannot be read by block yet');
    expect(text).toContain('Assets from other protocols may still exist');
    expect(text).not.toContain('Every supported protocol proved it');
  });

  it('shows the Zcash privacy boundary', () => {
    const element = render(summary({
      chain: 'zcash',
      privacy: { notice: 'Shielded transaction components cannot be inspected.', untrackableEventsAtomic: '2' },
    })).nativeElement as HTMLElement;
    expect(element.textContent).toContain('Shielded transaction components cannot be inspected.');
    expect(element.textContent).toContain('2 assets moved into shielded components');
  });
});

describe('BlockAssetsComponent live and previews', () => {
  it('reads the summary again when the live channel reports this block replaced', async () => {
    const { Subject } = await import('rxjs');
    const stream = new Subject<unknown>();
    let reads = 0;
    const api = {
      getBlockAssetActivity$: () => { reads += 1; return of(summary()); },
      getBlockAssetEvents$: () => of(page([])),
    } as unknown as UniverseApiService;
    const live = { stream$: () => stream } as never;
    const component = new BlockAssetsComponent(api, { markForCheck: () => undefined } as never, live);
    component.chain = 'bitcoin';
    component.reference = HASH;
    component.ngOnChanges(referenceChange);
    expect(reads).toBe(1);
    stream.next({ channel: 'chain-status', data: {} });
    stream.next({ channel: 'block-assets', data: { reorged: [{ orphanedHash: 'c'.repeat(64), replacementHash: 'd'.repeat(64) }] } });
    expect(reads).toBe(1);
    stream.next({ channel: 'block-assets', data: { reorged: [{ orphanedHash: HASH, replacementHash: 'd'.repeat(64) }] } });
    expect(reads).toBe(2);
    component.ngOnDestroy();
  });

  it('offers an inscription preview only for inscription protocols, and gives up after a failure', () => {
    const api = {
      getBlockAssetActivity$: () => of(summary()),
      getBlockAssetEvents$: () => of(page([])),
      inscriptionPreviewUrl: (chain: string, network: string, id: string) => `/preview/${chain}/${network}/${id}`,
    } as unknown as UniverseApiService;
    const component = new BlockAssetsComponent(api, { markForCheck: () => undefined } as never);
    component.chain = 'bitcoin';
    component.reference = HASH;
    component.ngOnChanges(referenceChange);
    const id = `${TXID}i0`;
    const inscription = {
      ...EVENT,
      protocolId: 'ordinals',
      operation: 'inscribe',
      asset: { protocolId: 'ordinals', assetId: id, contentId: id, assetKind: 'inscription' },
    } as BlockAssetEvent;
    expect(component.previewUrl(inscription)).toBe(`/preview/bitcoin/mainnet/${id}`);
    expect(component.previewUrl(EVENT)).toBeNull();
    component.previewFailed(inscription);
    expect(component.previewUrl(inscription)).toBeNull();
  });
});
