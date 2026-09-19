import { describe, expect, it } from 'vitest';
import { SimpleChange, SimpleChanges } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, TimeoutError, of, throwError } from 'rxjs';
import { TransactionAssetsComponent, SummaryViewState } from './transaction-assets.component';
import { TransactionAssetSummary } from './transaction-assets.types';
import { ExplorerProtocolDefinition } from '@app/universe/universe.types';

const TXID = 'a'.repeat(64);

function summary(overrides: Partial<TransactionAssetSummary> = {}): TransactionAssetSummary {
  return {
    schemaVersion: 'universe-transaction-asset-summary-v1',
    chain: 'bitcoin',
    network: 'signet',
    txid: TXID,
    status: 'confirmed',
    assets: [
      {
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
      },
    ],
    perProtocolCoverage: [
      { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'complete' },
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
    ...overrides,
  };
}

function componentWith(
  source: () => Observable<TransactionAssetSummary>,
  protocols: ExplorerProtocolDefinition[] = [
    { id: 'runes', shortName: 'RUNES', displayName: 'Runes', visualToken: 'runes' } as ExplorerProtocolDefinition,
    { id: 'brc20', shortName: 'BRC-20', displayName: 'BRC-20', visualToken: 'brc20' } as ExplorerProtocolDefinition,
  ],
): TransactionAssetsComponent {
  const api = {
    getTransactionAssets$: () => source(),
    getProtocols$: () => of({ protocols } as never),
  } as never;
  const component = new TransactionAssetsComponent(api);
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

describe('TransactionAssetsComponent request lifecycle', () => {
  it('starts loading and then renders the summary', () => {
    const component = componentWith(() => of(summary()));
    component.ngOnChanges(txidChange());
    expect(collect(component).map((state) => state.kind)).toEqual(['loading', 'summary']);
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

  it('separates timeout, not found, unconfigured and other failures', () => {
    const cases: [unknown, string][] = [
      [new TimeoutError(), 'timeout'],
      [new HttpErrorResponse({ status: 404 }), 'not-found'],
      [new HttpErrorResponse({ status: 503 }), 'unconfigured'],
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
  });

  it('re-requests exactly once per explicit retry', async () => {
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
});

describe('TransactionAssetsComponent presentation', () => {
  const component = componentWith(() => of(summary()));

  /** The view state a rendered summary produces, with registry names resolved. */
  function view(overrides: Partial<TransactionAssetSummary> = {}): SummaryViewState {
    const rendering = componentWith(() => of(summary(overrides)));
    rendering.ngOnChanges(txidChange());
    const states = collect(rendering);
    const rendered = states[states.length - 1];
    if (rendered.kind !== 'summary') {throw new Error('expected a rendered summary');}
    return rendered;
  }

  it('renders the exact decimal amount from the stated divisibility', () => {
    const [row] = component.rows(view());
    expect(row.outputs).toEqual({ kind: 'exact', value: '12.34', partial: false });
  });

  it('labels digits as smallest units when divisibility is unknown', () => {
    const state = view();
    state.summary.assets[0].decimals = null;
    const [row] = component.rows(state);
    expect(row.outputs).toEqual({ kind: 'raw', value: '1234', partial: false });
  });

  it('shows an unstated amount as not published rather than zero', () => {
    const [row] = component.rows(view());
    expect(row.inputs.kind).toBe('none');
    expect(row.inputs.value).toBe('');
    expect(row.inputs.partial).toBe(true);
  });

  it('keys rows by full identity so two protocols do not merge', () => {
    const state = view();
    state.summary.assets = [
      state.summary.assets[0],
      { ...state.summary.assets[0], protocolId: 'alkanes' },
    ];
    const keys = component.rows(state).map((row) => row.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('keeps two rulesets of one ledger as separate rows', () => {
    const state = view();
    state.summary.assets = [
      { ...state.summary.assets[0], ruleset: 'strict' },
      { ...state.summary.assets[0], ruleset: 'lenient' },
    ];
    expect(new Set(component.rows(state).map((row) => row.key)).size).toBe(2);
  });

  it('names the sources that left the inventory incomplete, officially', () => {
    expect(component.incomplete(summary())).toBe(true);
    expect(component.gapCount(summary())).toBe(1);
    // The registry's published name, not the internal id.
    expect(component.gapNames(view())).toEqual(['BRC-20']);
  });

  it('falls back to a readable id when the registry is unavailable', () => {
    const bare = componentWith(() => of(summary()), []);
    bare.ngOnChanges(txidChange());
    const states = collect(bare);
    const rendered = states[states.length - 1];
    if (rendered.kind !== 'summary') {throw new Error('expected a rendered summary');}
    expect(bare.gapNames(rendered)).toEqual(['brc20']);
    // Amounts are untouched by missing presentation metadata.
    expect(bare.rows(rendered)[0].outputs.value).toBe('12.34');
  });

  it('states the evidence chip and the count in plain words', () => {
    expect(component.summaryChip(summary())).toEqual({ state: 'state-partial', label: 'Partial' });
    expect(component.countLabel(summary())).toBe('1 asset found so far');

    const complete = summary();
    complete.counts.totalCount = 1;
    expect(component.summaryChip(complete)).toEqual({ state: 'state-proven', label: 'Complete' });
    expect(component.countLabel(complete)).toBe('1 asset');

    const empty = summary({ assets: [] });
    empty.counts.knownCountAtomic = '0';
    empty.counts.totalCount = 0;
    expect(component.summaryChip(empty)).toEqual({ state: 'state-proven', label: 'None found' });
    expect(component.countLabel(empty)).toBe('No supported assets');
  });

  it('gives every row a labelled stand-in when no logo is published', () => {
    const [row] = component.rows(view());
    expect(row.asset.logo).toBeNull();
    // A visible mark in the protocol's own hue, never an empty grey square.
    expect(row.initials).toBe('RU');
    expect(row.protocol.displayName).toBe('Runes');
  });

  it('does not repeat the asset id when it is already the title', () => {
    const [named] = component.rows(view());
    expect(named.subtitle).toBe('UNCOMMON.GOODS');

    const state = view();
    state.summary.assets[0] = { ...state.summary.assets[0], displayName: null, ticker: null };
    expect(component.rows(state)[0].subtitle).toBe('');
  });

  it('translates the authority classification into a plain word', () => {
    expect(component.rows(view())[0].kindLabel).toBe('Token');
    const state = view();
    state.summary.assets[0] = { ...state.summary.assets[0], assetKind: 'inscription' };
    expect(component.rows(state)[0].kindLabel).toBe('Collectible');
    const odd = view();
    odd.summary.assets[0] = { ...odd.summary.assets[0], assetKind: 'something-new' };
    expect(component.rows(odd)[0].kindLabel).toBe('');
  });

  it('claims none found only for a stated total of zero with no rows', () => {
    expect(component.provenEmpty(summary())).toBe(false);
    const empty = summary({ assets: [] });
    empty.counts.knownCountAtomic = '0';
    expect(component.provenEmpty(empty)).toBe(false);
    empty.counts.totalCount = 0;
    expect(component.provenEmpty(empty)).toBe(true);
  });

  it('falls back once per identity on a logo error, without a loop', () => {
    const state = view();
    const [row] = component.rows(state);
    expect(row.logoFailed).toBe(false);
    component.onLogoError(row.key);
    expect(component.rows(state)[0].logoFailed).toBe(true);
    component.onLogoError(row.key);
    expect(component.rows(state)[0].logoFailed).toBe(true);
  });

  it('clears logo failures when the transaction changes', () => {
    const state = view();
    const [row] = component.rows(state);
    component.onLogoError(row.key);
    component.ngOnChanges({ txid: new SimpleChange(TXID, 'b'.repeat(64), false) });
    component.txid = TXID;
    expect(component.rows(state)[0].logoFailed).toBe(false);
  });
});
