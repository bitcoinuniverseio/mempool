// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { AddressAssetsComponent } from './address-assets.component';
import { summarise } from '@app/universe/address-assets/address-assets.component';
import type { OutpointEnrichment } from '@app/universe/universe.types';

describe('address asset coverage and exact totals', () => {
  it.each([true,false])('keeps incomplete quantities unknown in either order: %s', reverse => {
    const a=result({positions:[position('runes','A','5')] as never});
    const b=result({outpoint:`${'b'.repeat(64)}:0`,positions:[{...position('runes','A') as any,outpoint:`${'b'.repeat(64)}:0`}] as never});
    expect(summarise(reverse?[b,a]:[a,b]).holdings[0].quantityAtomic).toBeNull();
  });
  it('never sums duplicate results or accepts unrelated positions',()=>{
    const a=result({positions:[position('runes','A','5')] as never});
    expect(summarise([a,a])).toMatchObject({resolved:1,partial:true});
    expect(summarise([result({positions:[{...position('runes','A','5') as any,outpoint:`${'b'.repeat(64)}:0`}] as never})])).toMatchObject({holdings:[],partial:true});
  });
  it('shows an explicit source limit without querying asset authority',async()=>{
    const api={getOutpoints$:vi.fn()},component=new AddressAssetsComponent(api as any);
    component.sourceState='limit';component.ngOnChanges({sourceState:{} as any});
    expect(await firstValueFrom(component.state$)).toMatchObject({kind:'source-unavailable',reason:expect.stringContaining('500')});
    expect(api.getOutpoints$).not.toHaveBeenCalled();
  });
  it('counts missing requested outputs as unresolved',()=>{
    const api={getOutpoints$:vi.fn(()=>of({results:[result()]}))},component=new AddressAssetsComponent(api as any);
    component.utxos=[{txid:'a'.repeat(64),vout:0},{txid:'b'.repeat(64),vout:0}] as any;
    component.sourceState='complete';component.ngOnChanges({utxos:{} as any});
    const values:any[]=[];component.state$.subscribe(value=>values.push(value));
    expect(values[1]).toMatchObject({kind:'ready',resolved:1,notResolved:1,partial:true});
  });
});

function result(patch: Partial<OutpointEnrichment> = {}): OutpointEnrichment {
  return {
    outpoint: `${'a'.repeat(64)}:0`,
    status: 'ok',
    positions: [],
    coveredProtocolIds: [],
    unknownAttachments: false,
    checkpoint: null,
    ...patch,
  };
}

function position(
  protocolId: string,
  assetId: string,
  quantityAtomic?: string
): unknown {
  return {
    outpoint: `${'a'.repeat(64)}:0`,
    vout: 0,
    valueSatsAtomic: '546',
    asset: {
      protocolId,
      assetId: assetId,
      assetKind: 'fungible',
      displayName: assetId,
    },
    quantityAtomic,
    state: 'unspent',
    evidence: { authorityId: 'ord', coverage: 'complete' },
  };
}

describe('summarise', () => {
  it('reports nothing for no results', () => {
    const summary = summarise([]);
    expect(summary.holdings).toEqual([]);
    expect(summary.resolved).toBe(0);
    expect(summary.partial).toBe(false);
  });

  it('counts only the outputs the authority actually answered for', () => {
    const summary = summarise([result(), result({ status: 'unavailable' })]);
    expect(summary.resolved).toBe(1);
    expect(summary.partial).toBe(true);
  });

  it('marks an unindexed output as incomplete coverage', () => {
    const summary = summarise([result({ status: 'not-indexed' })]);
    expect(summary.resolved).toBe(0);
    expect(summary.partial).toBe(true);
  });

  it('flags unknown attachments as partial', () => {
    const summary = summarise([result({ unknownAttachments: true })]);
    expect(summary.partial).toBe(true);
  });

  it('sums quantities across outputs without losing precision', () => {
    const big = '340282366920938463463374607431768211455';
    const summary = summarise([
      result({ positions: [position('runes', 'RUNE', big)] as never }),
      result({
        outpoint: `${'b'.repeat(64)}:0`,
        positions: [
          {
            ...(position('runes', 'RUNE', '1') as any),
            outpoint: `${'b'.repeat(64)}:0`,
          },
        ] as never,
      }),
    ]);
    expect(summary.holdings[0].quantityAtomic).toBe(
      (BigInt(big) + 1n).toString()
    );
  });

  it('keeps a holding with no quantity rather than inventing a zero', () => {
    const summary = summarise([
      result({ positions: [position('ordinals', 'insc1')] as never }),
    ]);
    expect(summary.holdings[0].quantityAtomic).toBeNull();
    expect(summary.holdings[0].outpoints).toHaveLength(1);
  });

  it('separates assets that share a protocol', () => {
    const summary = summarise([
      result({
        positions: [
          position('runes', 'A', '1'),
          position('runes', 'B', '2'),
        ] as never,
      }),
    ]);
    expect(summary.holdings).toHaveLength(2);
  });

  it('ignores a malformed quantity instead of guessing', () => {
    const summary = summarise([
      result({ positions: [position('runes', 'A', '-5')] as never }),
    ]);
    expect(summary.holdings[0].quantityAtomic).toBeNull();
  });

  it('drops a position with no protocol rather than filing it wrongly', () => {
    const summary = summarise([
      result({ positions: [{ outpoint: 'x', asset: {} }] as never }),
    ]);
    expect(summary.holdings).toEqual([]);
  });

  it('refuses to present mixed checkpoints as one observation', () => {
    const summary = summarise([
      result({
        checkpoint: { heightAtomic: '900000', blockHash: 'a' } as never,
      }),
      result({
        outpoint: `${'b'.repeat(64)}:0`,
        checkpoint: { heightAtomic: '900001', blockHash: 'b' } as never,
      }),
    ]);
    expect(summary.checkpointHeight).toBeNull();
    expect(summary.partial).toBe(true);
  });

  it('sorts holdings by protocol and refuses duplicate positions', () => {
    const summary = summarise([
      result({
        positions: [
          position('runes', 'A', '1'),
          position('runes', 'B', '1'),
          position('runes', 'B', '1'),
          position('ordinals', 'C'),
        ] as never,
      }),
    ]);
    expect(summary.holdings.map((holding) => holding.protocolId)).toEqual([
      'ordinals',
      'runes',
      'runes',
    ]);
    expect(
      summary.holdings.find((h) => h.displayName === 'B')?.quantityAtomic
    ).toBeNull();
    expect(summary.partial).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// WP04 and WP05: identity, units, scope and the rendered panel.
// ---------------------------------------------------------------------------

import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { StateService } from '@app/services/state.service';
import { resolveTemplates } from '@app/universe/asset-summary/asset-summary.test-render';
import { UniverseApiService } from '@app/universe/universe-api.service';
import type { AddressAssetsState } from './address-assets.component';

const CHECKPOINT = {
  chain: 'bitcoin',
  network: 'signet',
  heightAtomic: '240000',
  blockHash: 'c'.repeat(64),
  reorgEpoch: '0',
};

/** A result carrying a checkpoint, so identities have a chain and a network. */
function scoped(patch: Partial<OutpointEnrichment> = {}): OutpointEnrichment {
  return result({ checkpoint: CHECKPOINT as never, ...patch });
}

function positionAt(
  outpoint: string,
  asset: Record<string, unknown>,
  quantityAtomic?: string,
): unknown {
  return {
    outpoint,
    vout: Number(outpoint.slice(65)),
    valueSatsAtomic: '546',
    asset,
    quantityAtomic,
    state: 'unspent',
    evidence: { authorityId: 'ord', coverage: 'complete' },
  };
}

const OUT_A = `${'a'.repeat(64)}:0`;
const OUT_B = `${'b'.repeat(64)}:1`;

describe('address holdings keep the whole identity', () => {
  it('never merges two rulesets over one ledger', () => {
    const holdings = summarise([
      scoped({
        positions: [
          positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible', ruleset: 'strict' }, '5'),
          positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible', ruleset: 'lenient' }, '7'),
        ] as never,
      }),
    ]).holdings;
    // Two rulesets are two assets. A merged total is one no authority states.
    expect(holdings).toHaveLength(2);
    expect(holdings.map((holding) => holding.quantityAtomic).sort()).toEqual(['5', '7']);
  });

  it('carries the chain, network, kind and ruleset through to the row', () => {
    const [holding] = summarise([
      scoped({
        positions: [
          positionAt(OUT_A, {
            protocolId: 'runes',
            assetId: 'UNCOMMON.GOODS',
            assetKind: 'fungible',
            ticker: 'UNCOMMON',
            displayName: 'Uncommon Goods',
            ruleset: 'strict',
            decimals: 2,
          }, '1234'),
        ] as never,
      }),
    ]).holdings;
    expect(holding.chain).toBe('bitcoin');
    expect(holding.network).toBe('signet');
    expect(holding.assetKind).toBe('fungible');
    expect(holding.ruleset).toBe('strict');
    expect(holding.ticker).toBe('UNCOMMON');
    expect(holding.decimals).toBe(2);
  });

  it('keeps the stated divisibility and leaves a conflict unknown', () => {
    const one = summarise([
      scoped({
        positions: [
          positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible', decimals: 8 }, '100000000'),
        ] as never,
      }),
    ]).holdings[0];
    expect(one.decimals).toBe(8);

    // Two outputs, because one output cannot hold one identity twice: that is
    // the duplicate guard, and it is a different rule from this one.
    const conflicted = summarise([
      scoped({
        positions: [
          positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible', decimals: 2 }, '1'),
        ] as never,
      }),
      scoped({
        outpoint: OUT_B,
        positions: [
          positionAt(OUT_B, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible', decimals: 8 }, '1'),
        ] as never,
      }),
    ]).holdings[0];
    // Unknown, not the last one stated: the scale would be off by six orders.
    expect(conflicted.decimals).toBeNull();
    // The atomic sum is still exact.
    expect(conflicted.quantityAtomic).toBe('2');
  });

  it('refuses an out-of-range divisibility without disturbing a valid one', () => {
    const holding = summarise([
      scoped({
        positions: [
          positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible', decimals: 39 }, '1'),
        ] as never,
      }),
      scoped({
        outpoint: OUT_B,
        positions: [
          positionAt(OUT_B, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible', decimals: 8 }, '1'),
        ] as never,
      }),
    ]).holdings[0];
    expect(holding.decimals).toBe(8);
  });

  it('counts an inscription as one item and an absent fungible amount as unknown', () => {
    const inscription = summarise([
      scoped({
        positions: [
          positionAt(OUT_A, { protocolId: 'ordinals', assetId: 'i0', assetKind: 'inscription' }),
        ] as never,
      }),
    ]).holdings[0];
    // One item by the protocol's own definition, which is the contract.
    expect(inscription.quantityAtomic).toBe('1');
    expect(inscription.quantityKnown).toBe(true);

    const fungible = summarise([
      scoped({
        positions: [
          positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible' }),
        ] as never,
      }),
    ]).holdings[0];
    expect(fungible.quantityAtomic).toBeNull();
    expect(fungible.quantityKnown).toBe(false);
  });

  it('tracks a known quantity separately from the coverage of the scope', () => {
    const summary = summarise([
      scoped({ positions: [positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible' }, '5')] as never }),
      scoped({ outpoint: OUT_B, status: 'unavailable' as never }),
    ]);
    // The sum of what was read is exact; the set it was read from is not whole.
    expect(summary.holdings[0].quantityKnown).toBe(true);
    expect(summary.holdings[0].quantityAtomic).toBe('5');
    expect(summary.partial).toBe(true);
  });

  it('sums beyond the safe integer range exactly', () => {
    const big = '90071992547409910';
    const holding = summarise([
      scoped({
        positions: [
          positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible', decimals: 0 }, big),
        ] as never,
      }),
      scoped({
        outpoint: OUT_B,
        positions: [
          positionAt(OUT_B, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible', decimals: 0 }, big),
        ] as never,
      }),
    ]).holdings[0];
    expect(holding.quantityAtomic).toBe('180143985094819820');
  });
});

describe('address holdings scope and empty states', () => {
  function component(
    results: OutpointEnrichment[],
    utxos: { txid: string; vout: number }[],
    calls?: { count: () => void },
  ): AddressAssetsComponent {
    const api = {
      getOutpoints$: () => {
        calls?.count();
        return of({ results });
      },
    };
    const built = new AddressAssetsComponent(api as never);
    built.utxos = utxos as never;
    built.sourceState = 'complete';
    return built;
  }

  function states(built: AddressAssetsComponent): AddressAssetsState[] {
    built.ngOnChanges({ utxos: {} as never });
    const collected: AddressAssetsState[] = [];
    const subscription = built.state$.subscribe((state) => collected.push(state));
    subscription.unsubscribe();
    return collected;
  }

  it('states a checked and a total denominator', () => {
    const built = component(
      [scoped({ positions: [positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible' }, '5')] as never })],
      [{ txid: 'a'.repeat(64), vout: 0 }, { txid: 'b'.repeat(64), vout: 1 }],
    );
    const last = states(built).pop() as AddressAssetsState;
    expect(last.resolved).toBe(1);
    expect(last.total).toBe(2);
    expect(last.notResolved).toBe(1);
    // Outputs this page did not ask about leave the scope partial even though
    // every output it did ask about answered.
    expect(last.partial).toBe(true);
    expect(last.provenEmpty).toBe(false);
  });

  it('separates an authoritative empty output list from no input at all', async () => {
    const empty = new AddressAssetsComponent({ getOutpoints$: vi.fn() } as never);
    empty.utxos = [] as never;
    empty.sourceState = 'complete';
    empty.ngOnChanges({ utxos: {} as never });
    const answered = await firstValueFrom(empty.state$);
    // A real answer: there is nothing for an asset to sit on.
    expect(answered).toMatchObject({ kind: 'ready', provenEmpty: true, total: 0 });

    const absent = new AddressAssetsComponent({ getOutpoints$: vi.fn() } as never);
    absent.utxos = null;
    absent.sourceState = 'complete';
    absent.ngOnChanges({ utxos: {} as never });
    // No input is not an answer about this address.
    expect(await firstValueFrom(absent.state$)).toMatchObject({ kind: 'skipped' });
  });

  it('claims proven empty only when every output was checked and held nothing', () => {
    const complete = component([scoped()], [{ txid: 'a'.repeat(64), vout: 0 }]);
    expect((states(complete).pop() as AddressAssetsState).provenEmpty).toBe(true);

    const incomplete = component(
      [scoped({ status: 'unavailable' as never })],
      [{ txid: 'a'.repeat(64), vout: 0 }],
    );
    const last = incomplete.ngOnChanges({ utxos: {} as never });
    void last;
    const collected: AddressAssetsState[] = [];
    const subscription = incomplete.state$.subscribe((state) => collected.push(state));
    subscription.unsubscribe();
    expect((collected.pop() as AddressAssetsState).provenEmpty).toBe(false);
  });

  it('retries the read once per press, without polling', () => {
    let calls = 0;
    const built = component(
      [scoped()],
      [{ txid: 'a'.repeat(64), vout: 0 }],
      { count: () => { calls += 1; } },
    );
    built.ngOnChanges({ utxos: {} as never });
    const subscription = built.state$.subscribe();
    expect(calls).toBe(1);
    built.retry();
    expect(calls).toBe(2);
    subscription.unsubscribe();
  });

  it('clears the open rows when the address input changes', () => {
    const built = component(
      [scoped({ positions: [positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible' }, '5')] as never })],
      [{ txid: 'a'.repeat(64), vout: 0 }],
    );
    const last = states(built).pop() as AddressAssetsState;
    const holding = (last.holdings as never as { assetKey: string }[])[0];
    built.toggle(holding as never);
    expect(built.expanded.size).toBe(1);
    built.ngOnChanges({ utxos: {} as never });
    expect(built.expanded.size).toBe(0);
  });

  it('splits an outpoint only when it really is one', () => {
    const built = new AddressAssetsComponent({ getOutpoints$: vi.fn() } as never);
    expect(built.outpointParts(OUT_A)).toEqual({ txid: 'a'.repeat(64), vout: '0' });
    expect(built.outpointParts('not-an-outpoint')).toBeNull();
    expect(built.outpointParts(`${'a'.repeat(63)}:0`)).toBeNull();
  });

  it('reports a clipboard denial rather than claiming a copy succeeded', async () => {
    const built = new AddressAssetsComponent({ getOutpoints$: vi.fn() } as never);
    const original = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
    });
    try {
      built.copy('k', '5');
      await Promise.resolve();
      await Promise.resolve();
      expect(built.copyResult('k')).toBe('failed');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original });
    }
  });
});

/**
 * Rendered template tests.
 *
 * The panel's claims are as much about wording and routing as about numbers, and
 * neither a lost network prefix nor a dropped outpoint link is visible from a
 * class-level test.
 */
describe('address holdings rendered panel', () => {
  beforeAll(async () => {
    Object.defineProperty(AddressAssetsComponent, 'ctorParameters', {
      configurable: true,
      value: () => [{ type: UniverseApiService }],
    });
    await resolveTemplates(import.meta.url);
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  function render(results: OutpointEnrichment[], utxos: { txid: string; vout: number }[]) {
    TestBed.configureTestingModule({
      imports: [AddressAssetsComponent],
      providers: [
        provideRouter([]),
        { provide: UniverseApiService, useValue: { getOutpoints$: () => of({ results }) } },
        // The network the links have to carry. Without it the pipe returns the
        // bare path and the assertion below could not tell the two apart.
        { provide: StateService, useValue: { network: 'signet', env: { ROOT_NETWORK: 'mainnet', BASE_MODULE: 'mempool' } } },
      ],
      errorOnUnknownElements: false,
      errorOnUnknownProperties: false,
    });
    const view = TestBed.createComponent(AddressAssetsComponent);
    view.componentInstance.utxos = utxos as never;
    view.componentInstance.sourceState = 'complete';
    view.componentInstance.ngOnChanges({ utxos: {} as never });
    view.detectChanges();
    return view;
  }

  const HOLDING = [
    scoped({
      positions: [
        positionAt(OUT_A, {
          protocolId: 'runes',
          assetId: 'UNCOMMON.GOODS',
          assetKind: 'fungible',
          displayName: 'Uncommon Goods',
          ticker: 'UNCOMMON',
          decimals: 2,
        }, '1234'),
      ] as never,
    }),
  ];
  const ONE_UTXO = [{ txid: 'a'.repeat(64), vout: 0 }];

  it('labels the quantity Held and never implies a whole wallet', () => {
    const view = render(HOLDING, ONE_UTXO);
    const text = view.nativeElement.textContent as string;
    expect(text).toContain('Held');
    expect(text).toContain('Positions');
    expect(text).toContain('12.34');
    // Not a wallet valuation and not a fiat total.
    expect(text).not.toContain('Received');
    expect(text).not.toContain('Balance');
    expect(text).not.toContain('$');
  });

  it('keeps a real table with a row header', () => {
    const element = render(HOLDING, ONE_UTXO).nativeElement as HTMLElement;
    expect(element.querySelector('table.summary-table')).not.toBeNull();
    const rowHeader = element.querySelector('tbody th[scope="row"]');
    expect(rowHeader).not.toBeNull();
    expect(rowHeader?.querySelector('.asset-identity-box')).not.toBeNull();
  });

  it('states the checked and total scope with a denominator', () => {
    const view = render(HOLDING, [...ONE_UTXO, { txid: 'b'.repeat(64), vout: 1 }]);
    expect(view.nativeElement.textContent).toContain('Checked 1 of 2 unspent outputs');
  });

  it('moves every outpoint link into the row details, network-correct', () => {
    const view = render(HOLDING, ONE_UTXO);
    const element = view.nativeElement as HTMLElement;
    // Not above everything else by default: the panel is not a wall of links.
    expect(element.querySelector('.outpoint-list')).toBeNull();
    (element.querySelector('button.asset-disclose') as HTMLButtonElement).click();
    view.detectChanges();
    const links = element.querySelectorAll('.outpoint-list a');
    expect(links).toHaveLength(1);
    // The defect this closes: a bare /outpoint route resolves against the root
    // network, so on signet the link pointed at the mainnet outpoint.
    expect(links[0].getAttribute('href')).toBe(`/signet/outpoint/${'a'.repeat(64)}/0`);
  });

  it('shows the full id and the exact amount only in the details', () => {
    const view = render(HOLDING, ONE_UTXO);
    const element = view.nativeElement as HTMLElement;
    (element.querySelector('button.asset-disclose') as HTMLButtonElement).click();
    view.detectChanges();
    const details = element.querySelector('.asset-details-row');
    expect(details?.textContent).toContain('UNCOMMON.GOODS');
    expect(details?.textContent).toContain('bitcoin / signet / runes');
    expect(details?.textContent).toContain('strict'.slice(0, 0) + '12.34');
  });

  it('names the disclosure and says what it controls', () => {
    const element = render(HOLDING, ONE_UTXO).nativeElement as HTMLElement;
    const button = element.querySelector('button.asset-disclose');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-controls')).toBeTruthy();
    expect(button?.getAttribute('aria-label')).toContain('Uncommon Goods');
  });

  it('says smallest units rather than scaling an unknown divisibility', () => {
    const view = render(
      [
        scoped({
          positions: [
            positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible', displayName: 'A' }, '1234'),
          ] as never,
        }),
      ],
      ONE_UTXO,
    );
    expect(view.nativeElement.textContent).toContain('smallest units');
  });

  it('says Not published rather than hiding an unknown amount', () => {
    const view = render(
      [
        scoped({
          positions: [
            positionAt(OUT_A, { protocolId: 'runes', assetId: 'A', assetKind: 'fungible', displayName: 'A' }),
          ] as never,
        }),
      ],
      ONE_UTXO,
    );
    expect(view.nativeElement.textContent).toContain('Not published');
  });

  it('words a proven empty address differently from a partial one', () => {
    const proven = render([scoped()], ONE_UTXO);
    expect(proven.nativeElement.textContent).toContain('Every unspent output this address holds was checked');

    TestBed.resetTestingModule();
    const partial = render([scoped({ status: 'unavailable' as never })], ONE_UTXO);
    const text = partial.nativeElement.textContent as string;
    expect(text).toContain('not every output could be checked');
    expect(text).toContain('not proof');
  });

  it('offers a retry while the scope is partial', () => {
    const view = render([scoped({ status: 'unavailable' as never })], ONE_UTXO);
    expect(view.nativeElement.querySelector('.summary-coverage .summary-retry')).not.toBeNull();
  });
});
