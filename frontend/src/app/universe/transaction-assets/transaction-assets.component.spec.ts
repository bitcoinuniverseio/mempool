// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SimpleChange, SimpleChanges } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { Observable, TimeoutError, of, throwError } from 'rxjs';
import {
  SummaryViewModel,
  SummaryViewState,
  TransactionAssetsComponent,
} from './transaction-assets.component';
import { SummaryAsset, TransactionAssetSummary } from './transaction-assets.types';
import { ExplorerProtocolDefinition } from '@app/universe/universe.types';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { resolveTemplates } from '@app/universe/asset-summary/asset-summary.test-render';

const TXID = 'a'.repeat(64);
const BLOCK_HASH = 'c'.repeat(64);

function runesAsset(overrides: Partial<SummaryAsset> = {}): SummaryAsset {
  return {
    chain: 'bitcoin',
    network: 'signet',
    protocolId: 'runes',
    assetId: 'UNCOMMON.GOODS',
    ruleset: null,
    assetKind: 'fungible',
    displayName: 'Uncommon Goods',
    ticker: 'UNCOMMON',
    decimals: 2,
    logo: null,
    inputs: { quantityAtomic: null, positionCountAtomic: '0', complete: false },
    outputs: { quantityAtomic: '1234', positionCountAtomic: '1', complete: true },
    effects: [],
    evidence: [],
    ...overrides,
  };
}

function summary(overrides: Partial<TransactionAssetSummary> = {}): TransactionAssetSummary {
  return {
    schemaVersion: 'universe-transaction-asset-summary-v1',
    chain: 'bitcoin',
    network: 'signet',
    txid: TXID,
    status: 'confirmed',
    assets: [runesAsset()],
    perProtocolCoverage: [
      { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'complete', reason: 'reader-answered' },
      { protocolId: 'brc20', chain: 'bitcoin', network: 'signet', state: 'unconfigured', reason: 'no-transaction-reader' },
    ],
    counts: {
      fungibleTypeCountAtomic: '1',
      collectibleItemCountAtomic: '0',
      otherAssetCountAtomic: '0',
      protocolCountAtomic: '1',
      knownCountAtomic: '1',
      totalCount: null,
    },
    retryAfterSeconds: 5,
    checkpoint: {
      chain: 'bitcoin',
      network: 'signet',
      heightAtomic: '240000',
      blockHash: BLOCK_HASH,
      reorgEpoch: '0',
      observedAt: '2026-09-19T00:00:00.000Z',
    },
    ...overrides,
  };
}

const PROTOCOLS: ExplorerProtocolDefinition[] = [
  { id: 'runes', shortName: 'RUNES', displayName: 'Runes', visualToken: 'runes' } as ExplorerProtocolDefinition,
  { id: 'brc20', shortName: 'BRC-20', displayName: 'BRC-20', visualToken: 'brc20' } as ExplorerProtocolDefinition,
];

function apiFor(
  source: () => Observable<TransactionAssetSummary>,
  protocols: ExplorerProtocolDefinition[] = PROTOCOLS,
  protocolSource?: () => Observable<unknown>,
): never {
  return {
    getTransactionAssets$: () => source(),
    getProtocols$: () => protocolSource ? protocolSource() : of({ protocols } as never),
  } as never;
}

function componentWith(
  source: () => Observable<TransactionAssetSummary>,
  protocols: ExplorerProtocolDefinition[] = PROTOCOLS,
  protocolSource?: () => Observable<unknown>,
): TransactionAssetsComponent {
  const component = new TransactionAssetsComponent(apiFor(source, protocols, protocolSource));
  component.txid = TXID;
  component.chain = 'bitcoin';
  return component;
}

/**
 * The states one subscription sees. The component's stream is driven by a
 * retry subject that never completes, so states are collected from a live
 * subscription rather than waiting for a completion that never arrives.
 */
function collect(component: TransactionAssetsComponent): SummaryViewState[] {
  const states: SummaryViewState[] = [];
  const subscription = component.state$.subscribe((state) => states.push(state));
  subscription.unsubscribe();
  return states;
}

function txidChange(): SimpleChanges {
  return { txid: new SimpleChange(undefined, TXID, true) };
}

/** The model of the last rendered summary, with registry names resolved. */
function model(
  overrides: Partial<TransactionAssetSummary> = {},
  protocols: ExplorerProtocolDefinition[] = PROTOCOLS,
): SummaryViewModel {
  const component = componentWith(() => of(summary(overrides)), protocols);
  component.ngOnChanges(txidChange());
  const states = collect(component);
  const rendered = states[states.length - 1];
  if (rendered.kind !== 'summary' || !rendered.model) {
    throw new Error('expected a rendered summary');
  }
  return rendered.model;
}

describe('TransactionAssetsComponent request lifecycle', () => {
  it('starts loading and then renders the summary', () => {
    const component = componentWith(() => of(summary()));
    component.ngOnChanges(txidChange());
    const kinds = collect(component).map((state) => state.kind);
    expect(kinds[0]).toBe('loading');
    expect(kinds[kinds.length - 1]).toBe('summary');
  });

  it('renders proven amounts before the optional registry has answered', () => {
    // The registry stream is seeded, so combineLatest does not hold a proven
    // quantity behind an optional display name. Never emitting a name at all is
    // the strongest form of "slow".
    const component = componentWith(
      () => of(summary()),
      [],
      () => new Observable<never>(),
    );
    component.ngOnChanges(txidChange());
    const states = collect(component);
    const rendered = states[states.length - 1];
    expect(rendered.kind).toBe('summary');
    expect(rendered.model?.rows[0].outputs.headline).toBe('12.34');
    // The id stands in for the name that never arrived, rather than blocking.
    expect(rendered.model?.rows[0].protocol.displayName).toBe('runes');
  });

  it('does not request again for an unrelated change', () => {
    let calls = 0;
    const component = componentWith(() => {
      calls += 1;
      return of(summary());
    });
    component.ngOnChanges(txidChange());
    component.ngOnChanges({});
    expect(component.state$).toBeDefined();
    expect(calls).toBe(0);
  });

  it('separates timeout, not found, unconfigured, outage and other failures', () => {
    const cases: [unknown, string][] = [
      [new TimeoutError(), 'timeout'],
      [new HttpErrorResponse({ status: 404 }), 'not-found'],
      [new HttpErrorResponse({ status: 503 }), 'unconfigured'],
      // An upstream outage is a different fact from "not set up": telling a
      // visitor the deployment lacks a source sends them to fix the wrong thing.
      [new HttpErrorResponse({ status: 502 }), 'unavailable'],
      [new HttpErrorResponse({ status: 504 }), 'unavailable'],
      [new HttpErrorResponse({ status: 500 }), 'error'],
      [new Error('decode failed'), 'error'],
    ];
    for (const [error, expected] of cases) {
      const component = componentWith(() => throwError(() => error));
      component.ngOnChanges(txidChange());
      const states = collect(component);
      expect(states[states.length - 1].kind).toBe(expected);
    }
  });

  it('never turns a failure into an empty asset list', () => {
    const component = componentWith(() => throwError(() => new HttpErrorResponse({ status: 500 })));
    component.ngOnChanges(txidChange());
    const states = collect(component);
    const last = states[states.length - 1];
    expect(last.kind).toBe('error');
    expect(last.summary).toBeUndefined();
    expect(last.model).toBeUndefined();
  });

  it('re-requests exactly once per explicit retry', () => {
    let calls = 0;
    const component = componentWith(() => {
      calls += 1;
      return of(summary());
    });
    component.ngOnChanges(txidChange());
    const subscription = component.state$.subscribe();
    expect(calls).toBe(1);
    component.retry();
    expect(calls).toBe(2);
    subscription.unsubscribe();
  });

  it('honours a retry cooldown instead of allowing a burst', () => {
    let calls = 0;
    const component = componentWith(() => {
      calls += 1;
      return of(summary());
    });
    component.ngOnChanges(txidChange());
    const subscription = component.state$.subscribe();
    component.retry(5);
    expect(calls).toBe(2);
    expect(component.retryCooldown).toBe(true);
    component.retry(5);
    component.retry(5);
    // Nothing during the cooldown the payload itself asked for, and no polling.
    expect(calls).toBe(2);
    subscription.unsubscribe();
    component.ngOnDestroy();
  });
});

describe('TransactionAssetsComponent presentation model', () => {
  it('renders the exact decimal amount from the stated divisibility', () => {
    const [row] = model().rows;
    expect(row.outputs.kind).toBe('exact');
    expect(row.outputs.headline).toBe('12.34');
    expect(row.outputs.exact).toBe('12.34');
    expect(row.outputs.approximate).toBe(false);
  });

  it('labels digits as smallest units when divisibility is unknown', () => {
    const [row] = model({ assets: [runesAsset({ decimals: null })] }).rows;
    expect(row.outputs.kind).toBe('raw');
    expect(row.outputs.exact).toBe('1234');
  });

  it('shows an unstated amount as not published rather than zero', () => {
    const [row] = model().rows;
    expect(row.inputs.kind).toBe('unknown');
    expect(row.inputs.headline).toBe('');
    expect(row.inputs.partial).toBe(true);
  });

  it('keeps a very long amount on one line and the exact value for copying', () => {
    const [row] = model({
      assets: [
        runesAsset({
          decimals: 0,
          outputs: { quantityAtomic: '340282366920938463463374607431768211455', positionCountAtomic: '1', complete: true },
        }),
      ],
    }).rows;
    expect(row.outputs.approximate).toBe(true);
    expect(row.outputs.exact).toBe('340282366920938463463374607431768211455');
    expect(row.outputs.headline).not.toContain(' ');
  });

  it('keys rows by full identity so two protocols do not merge', () => {
    const keys = model({
      assets: [runesAsset(), runesAsset({ protocolId: 'alkanes' })],
      counts: { ...summary().counts, knownCountAtomic: '2' },
    }).rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('keeps two rulesets of one ledger as separate rows', () => {
    const keys = model({
      assets: [runesAsset({ ruleset: 'strict' }), runesAsset({ ruleset: 'lenient' })],
      counts: { ...summary().counts, knownCountAtomic: '2' },
    }).rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('states each gap with its own state and reason, not as waiting', () => {
    const built = model();
    expect(built.incomplete).toBe(true);
    expect(built.gaps).toHaveLength(1);
    const [gap] = built.gaps;
    // The registry's published name, not the internal id.
    expect(gap.name).toBe('BRC-20');
    expect(gap.stateLabel).toBe('No source set up');
    expect(gap.reasonLabel).toContain('No source reads this protocol');
    // A protocol nobody reads will not start answering because of a button.
    expect(gap.retryable).toBe(false);
    expect(built.retryable).toBe(false);
  });

  it('offers a retry only for a gap that could actually clear', () => {
    const built = model({
      perProtocolCoverage: [
        { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'unavailable', reason: 'authority-unavailable' },
      ],
    });
    expect(built.gaps[0].retryable).toBe(true);
    expect(built.retryable).toBe(true);
    expect(built.gaps[0].stateLabel).toBe('Source not reachable');
  });

  it('keeps a permanent limit distinct from an outage', () => {
    const states = model({
      perProtocolCoverage: [
        { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'unsupported-network', reason: 'unsupported-network' },
        { protocolId: 'brc20', chain: 'bitcoin', network: 'signet', state: 'not-publicly-observable', reason: 'public-proof-not-observable' },
      ],
    }).gaps;
    expect(states.map((entry) => entry.retryable)).toEqual([false, false]);
    expect(states[0].stateLabel).toBe('Not available on this network');
    expect(states[1].stateLabel).toBe('Not publicly verifiable');
  });

  it('falls back to a readable id when the registry is unavailable', () => {
    const built = model({}, []);
    expect(built.gaps[0].name).toBe('brc20');
    // Amounts are untouched by missing presentation metadata.
    expect(built.rows[0].outputs.headline).toBe('12.34');
  });

  it('states one overall badge and the count in plain words', () => {
    const partial = model();
    expect(partial.chip).toEqual({ state: 'state-partial', label: 'Partial' });
    expect(partial.countLabel).toBe('1 asset found so far');

    const complete = model({
      perProtocolCoverage: [
        { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'complete', reason: 'reader-answered' },
      ],
      counts: { ...summary().counts, totalCount: 1 },
    });
    expect(complete.chip).toEqual({ state: 'state-proven', label: 'Complete' });
    expect(complete.countLabel).toBe('1 asset');
    expect(complete.gaps).toHaveLength(0);

    const empty = model({
      assets: [],
      perProtocolCoverage: [
        { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'proven-empty', reason: 'reader-answered' },
      ],
      counts: { ...summary().counts, knownCountAtomic: '0', totalCount: 0 },
    });
    expect(empty.chip).toEqual({ state: 'state-proven', label: 'None found' });
    expect(empty.countLabel).toBe('No supported assets');
    expect(empty.provenEmpty).toBe(true);
  });

  it('claims none found only for a stated total of zero with no rows', () => {
    expect(model().provenEmpty).toBe(false);
    const unknownTotal = model({
      assets: [],
      counts: { ...summary().counts, knownCountAtomic: '0', totalCount: null },
    });
    // Nothing found and nothing proven is not the same as proven empty.
    expect(unknownTotal.provenEmpty).toBe(false);
  });

  it('gives every row a labelled stand-in when no logo is published', () => {
    const [row] = model().rows;
    expect(row.asset.logo).toBeNull();
    expect(row.initials).toBe('RU');
    expect(row.protocol.displayName).toBe('Runes');
  });

  it('shortens the id in the row and keeps the full one for the details', () => {
    const [named] = model().rows;
    expect(named.assetId).toBe('UNCOMMON.GOODS');

    const long = 'z'.repeat(60);
    const [row] = model({ assets: [runesAsset({ assetId: long })] }).rows;
    expect(row.subtitle.length).toBeLessThan(long.length);
    expect(row.assetId).toBe(long);
  });

  it('does not repeat the asset id when it is already the title', () => {
    const [row] = model({
      assets: [runesAsset({ displayName: null, ticker: null })],
    }).rows;
    expect(row.subtitle).toBe('');
  });

  it('translates the authority classification into a plain word', () => {
    expect(model().rows[0].kindLabel).toBe('Token');
    expect(model({ assets: [runesAsset({ assetKind: 'inscription' })] }).rows[0].kindLabel)
      .toBe('Collectible');
    expect(model({ assets: [runesAsset({ assetKind: 'something-new' })] }).rows[0].kindLabel)
      .toBe('');
  });

  it('says not accepted for an effect no authority accepted', () => {
    const [row] = model({
      assets: [
        runesAsset({
          effects: [
            { eventId: 'e1', actionType: 'transfer', quantityAtomic: '1234', accepted: false, evidence: null },
            { eventId: 'e2', actionType: 'mint', quantityAtomic: '1', accepted: true, evidence: null },
          ],
        }),
      ],
    }).rows;
    expect(row.effects[0].label).toBe('transfer (not accepted)');
    expect(row.effects[0].accepted).toBe(false);
    // Never "unconfirmed": base chain confirmation is not protocol acceptance.
    expect(row.effects[0].label).not.toContain('unconfirmed');
    expect(row.effects[1].label).toBe('mint');
  });

  it('keeps the effect authority from the preserved evidence', () => {
    const [row] = model({
      assets: [
        runesAsset({
          effects: [
            {
              eventId: 'e1',
              actionType: 'transfer',
              quantityAtomic: '1234',
              accepted: true,
              evidence: {
                authorityId: 'ord',
                protocolId: 'runes',
                coverage: 'complete',
                checkedAt: '2026-09-19T00:00:00.000Z',
                checkpoint: null,
              },
            },
          ],
        }),
      ],
    }).rows;
    expect(row.effects[0].authorityId).toBe('ord');
  });

  it('carries the checkpoint through, and its absence as absence', () => {
    expect(model().checkpoint?.heightAtomic).toBe('240000');
    expect(model({ checkpoint: null }).checkpoint).toBeNull();
  });

  it('falls back once per artwork revision on a logo error, without a loop', () => {
    const component = componentWith(() => of(summary({
      assets: [
        runesAsset({
          logo: {
            objectPath: '/universe-media/v1/objects/' + 'd'.repeat(64),
            contentHash: 'd'.repeat(64),
            mediaType: 'image/png',
            metadataRevision: 'rev-1',
            verified: true,
          },
        }),
      ],
    })));
    component.ngOnChanges(txidChange());
    const first = collect(component);
    const row = (first[first.length - 1].model as SummaryViewModel).rows[0];
    expect(row.logoFailed).toBe(false);
    component.onLogoError(row);
    expect(row.logoFailed).toBe(true);
    const again = collect(component);
    expect((again[again.length - 1].model as SummaryViewModel).rows[0].logoFailed).toBe(true);
  });

  it('gives replaced artwork its own attempt rather than the old failure', () => {
    const component = componentWith(() => of(summary({
      assets: [
        runesAsset({
          logo: {
            objectPath: '/universe-media/v1/objects/' + 'd'.repeat(64),
            contentHash: 'd'.repeat(64),
            mediaType: 'image/png',
            metadataRevision: 'rev-1',
            verified: true,
          },
        }),
      ],
    })));
    component.ngOnChanges(txidChange());
    const states = collect(component);
    const row = (states[states.length - 1].model as SummaryViewModel).rows[0];
    component.onLogoError(row);

    const replaced = componentWith(() => of(summary({
      assets: [
        runesAsset({
          logo: {
            objectPath: '/universe-media/v1/objects/' + 'e'.repeat(64),
            contentHash: 'e'.repeat(64),
            mediaType: 'image/png',
            metadataRevision: 'rev-2',
            verified: true,
          },
        }),
      ],
    })));
    replaced.ngOnChanges(txidChange());
    const next = collect(replaced);
    expect((next[next.length - 1].model as SummaryViewModel).rows[0].logoFailed).toBe(false);
  });

  it('clears the open rows and logo failures when the transaction changes', () => {
    const component = componentWith(() => of(summary()));
    component.ngOnChanges(txidChange());
    const states = collect(component);
    const row = (states[states.length - 1].model as SummaryViewModel).rows[0];
    component.toggle(row);
    expect(component.isExpanded(row)).toBe(true);
    component.onLogoError(row);

    component.ngOnChanges({ txid: new SimpleChange(TXID, 'b'.repeat(64), false) });
    // A row left open would show another transaction's details in place.
    expect(component.expanded.size).toBe(0);
    component.txid = TXID;
    const after = collect(component);
    expect((after[after.length - 1].model as SummaryViewModel).rows[0].logoFailed).toBe(false);
  });

  it('reports a clipboard denial instead of claiming a copy succeeded', async () => {
    const component = componentWith(() => of(summary()));
    const original = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
    });
    try {
      component.copy('k', '12.34');
      await Promise.resolve();
      await Promise.resolve();
      expect(component.copyResult('k')).toBe('failed');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original });
    }
  });

  it('reports a copy that actually happened', async () => {
    const component = componentWith(() => of(summary()));
    const original = (globalThis as { navigator?: unknown }).navigator;
    let written = '';
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: (value: string) => {
            written = value;
            return Promise.resolve();
          },
        },
      },
    });
    try {
      component.copy('k', '340282366920938463463374607431768211455');
      await Promise.resolve();
      await Promise.resolve();
      expect(component.copyResult('k')).toBe('copied');
      // The exact value, never the shortened headline.
      expect(written).toBe('340282366920938463463374607431768211455');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original });
    }
  });
});

/**
 * Rendered template tests.
 *
 * The class-level tests above prove the model. These prove the template
 * compiles and puts the model on the page, which a class-level test cannot: a
 * binding to a property that does not exist, a lost table semantic or a missing
 * aria attribute are all invisible until something renders.
 */
describe('TransactionAssetsComponent rendered template', () => {
  beforeAll(async () => {
    Object.defineProperty(TransactionAssetsComponent, 'ctorParameters', {
      configurable: true,
      value: () => [{ type: UniverseApiService }],
    });
    // The real template file, read from disk, so these assertions are about the
    // template that ships rather than about a copy kept here.
    await resolveTemplates(import.meta.url);
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  function render(overrides: Partial<TransactionAssetSummary> = {}) {
    TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [TransactionAssetsComponent],
      providers: [
        { provide: UniverseApiService, useValue: apiFor(() => of(summary(overrides))) },
      ],
      // The protocol badge is another component's concern and has its own tests.
      errorOnUnknownElements: false,
      errorOnUnknownProperties: false,
    });
    const view = TestBed.createComponent(TransactionAssetsComponent);
    view.componentInstance.txid = TXID;
    view.componentInstance.chain = 'bitcoin';
    view.componentInstance.ngOnChanges(txidChange());
    view.detectChanges();
    return view;
  }

  it('renders the amounts and the single coverage badge', () => {
    const view = render();
    const text = view.nativeElement.textContent as string;
    expect(text).toContain('12.34');
    expect(text).toContain('1 asset found so far');
    expect(text).toContain('Partial');
    expect(text).toContain('Not published');
  });

  it('keeps a real table with a row header, not a grid of divs', () => {
    const view = render();
    const element = view.nativeElement as HTMLElement;
    expect(element.querySelector('table.summary-table')).not.toBeNull();
    const rowHeader = element.querySelector('tbody th[scope="row"]');
    expect(rowHeader).not.toBeNull();
    // Flex belongs on a child of the cell. A th displayed as flex stops being a
    // table cell and the row loses its accessible name.
    expect(rowHeader?.querySelector('.asset-identity-box')).not.toBeNull();
    expect(element.querySelectorAll('thead th[scope="col"]').length).toBe(4);
  });

  it('gives each row a named disclosure that says what it controls', () => {
    const view = render();
    const element = view.nativeElement as HTMLElement;
    const button = element.querySelector('button.asset-disclose');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    const controls = button?.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(button?.getAttribute('aria-label')).toContain('Uncommon Goods');
    // Nothing is rendered for the region until it is opened.
    expect(element.querySelector('#' + controls)).toBeNull();
  });

  it('reveals the full identity and exact values when opened', () => {
    const view = render({
      assets: [
        runesAsset({
          decimals: 0,
          assetId: 'z'.repeat(60),
          outputs: { quantityAtomic: '340282366920938463463374607431768211455', positionCountAtomic: '1', complete: true },
        }),
      ],
    });
    const element = view.nativeElement as HTMLElement;
    const button = element.querySelector('button.asset-disclose') as HTMLButtonElement;
    button.click();
    view.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const text = element.textContent as string;
    // The complete id and the complete value, not the shortened stand-ins.
    expect(text).toContain('z'.repeat(60));
    expect(text).toContain('340282366920938463463374607431768211455');
    expect(element.querySelectorAll('button.copy-button').length).toBeGreaterThan(0);
  });

  it('puts an effect beside its own asset and labels acceptance truthfully', () => {
    const view = render({
      assets: [
        runesAsset({
          effects: [
            { eventId: 'e1', actionType: 'transfer', quantityAtomic: '1234', accepted: false, evidence: null },
          ],
        }),
      ],
    });
    const element = view.nativeElement as HTMLElement;
    (element.querySelector('button.asset-disclose') as HTMLButtonElement).click();
    view.detectChanges();
    const details = element.querySelector('.asset-details-row');
    expect(details).not.toBeNull();
    expect(details?.textContent).toContain('transfer (not accepted)');
    expect(element.textContent).not.toContain('unconfirmed');
  });

  it('states coverage per source rather than a count of things being waited on', () => {
    const view = render();
    const text = view.nativeElement.textContent as string;
    expect(text).toContain('Coverage details');
    expect(text).toContain('BRC-20');
    expect(text).toContain('No source set up');
    // "Waiting on" promises an answer that will never come for a missing reader.
    expect(text).not.toContain('Waiting on');
  });

  it('says a proven empty transaction is proven, not merely unknown', () => {
    const view = render({
      assets: [],
      perProtocolCoverage: [
        { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'proven-empty', reason: 'reader-answered' },
      ],
      counts: { ...summary().counts, knownCountAtomic: '0', totalCount: 0 },
    });
    const text = view.nativeElement.textContent as string;
    expect(text).toContain('No supported assets');
    expect(text).toContain('reports no supported assets');
  });

  it('says so when no source published the block it was read at', () => {
    const view = render({ checkpoint: null });
    expect(view.nativeElement.textContent).toContain('No source published the block');
  });

  it('renders a stand-in mark rather than a broken image box', () => {
    const view = render();
    const element = view.nativeElement as HTMLElement;
    expect(element.querySelector('img')).toBeNull();
    const fallback = element.querySelector('.asset-logo-fallback');
    expect(fallback?.textContent?.trim()).toBe('RU');
    // Decorative: the accessible name comes from the row header's text.
    expect(fallback?.getAttribute('aria-hidden')).toBe('true');
  });

  it('offers a retry on an outage and not on a proven absence', () => {
    const outage = render({
      perProtocolCoverage: [
        { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'unavailable', reason: 'authority-unavailable' },
      ],
    });
    expect(outage.nativeElement.querySelector('.summary-coverage .summary-retry')).not.toBeNull();

    // One testing module per rendered component; the second case needs its own.
    TestBed.resetTestingModule();
    const permanent = render();
    expect(permanent.nativeElement.querySelector('.summary-coverage .summary-retry')).toBeNull();
  });
});
