import { describe, expect, it } from 'vitest';
import { SimpleChange, SimpleChanges } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, TimeoutError, of, throwError } from 'rxjs';
import { TransactionAssetsComponent, SummaryViewState } from './transaction-assets.component';
import { TransactionAssetSummary } from './transaction-assets.types';

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

function componentWith(source: () => Observable<TransactionAssetSummary>): TransactionAssetsComponent {
  const api = { getTransactionAssets$: () => source() } as never;
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

  it('renders the exact decimal quantity from the stated divisibility', () => {
    const [row] = component.rows(summary());
    expect(row.outputs).toEqual({ kind: 'exact', value: '12.34', partial: false });
  });

  it('labels digits as atomic units when divisibility is unknown', () => {
    const view = summary();
    view.assets[0].decimals = null;
    const [row] = component.rows(view);
    expect(row.outputs).toEqual({ kind: 'atomic', value: '1234', partial: false });
  });

  it('shows an unstated quantity as unavailable rather than zero', () => {
    const [row] = component.rows(summary());
    expect(row.inputs.kind).toBe('unavailable');
    expect(row.inputs.value).toBe('');
    expect(row.inputs.partial).toBe(true);
  });

  it('keys rows by full identity so two protocols do not merge', () => {
    const view = summary();
    view.assets = [
      view.assets[0],
      { ...view.assets[0], protocolId: 'alkanes' },
    ];
    const keys = component.rows(view).map((row) => row.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('keeps two rulesets of one ledger as separate rows', () => {
    const view = summary();
    view.assets = [
      { ...view.assets[0], ruleset: 'strict' },
      { ...view.assets[0], ruleset: 'lenient' },
    ];
    expect(new Set(component.rows(view).map((row) => row.key)).size).toBe(2);
  });

  it('names the protocols that left the inventory incomplete', () => {
    expect(component.incomplete(summary())).toBe(true);
    expect(component.gaps(summary())).toEqual(['brc20']);
  });

  it('claims proven empty only for a stated total of zero with no rows', () => {
    expect(component.provenEmpty(summary())).toBe(false);
    const empty = summary({ assets: [] });
    empty.counts.knownCountAtomic = '0';
    expect(component.provenEmpty(empty)).toBe(false);
    empty.counts.totalCount = 0;
    expect(component.provenEmpty(empty)).toBe(true);
  });

  it('falls back once per identity on a logo error, without a loop', () => {
    const view = summary();
    const [row] = component.rows(view);
    expect(row.logoFailed).toBe(false);
    component.onLogoError(row.key);
    expect(component.rows(view)[0].logoFailed).toBe(true);
    component.onLogoError(row.key);
    expect(component.rows(view)[0].logoFailed).toBe(true);
  });

  it('clears logo failures when the transaction changes', () => {
    const view = summary();
    const [row] = component.rows(view);
    component.onLogoError(row.key);
    component.ngOnChanges({ txid: new SimpleChange(TXID, 'b'.repeat(64), false) });
    component.txid = TXID;
    expect(component.rows(view)[0].logoFailed).toBe(false);
  });
});
