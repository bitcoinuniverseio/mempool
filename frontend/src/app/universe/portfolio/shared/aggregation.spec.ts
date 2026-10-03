import { describe, expect, it } from 'vitest';
import {
  aggregatePortfolio,
  detectInternalTransfers,
  externalFlows,
  type AddressSnapshot,
  type PortfolioEventInput,
} from './aggregation';

const snapshot = (overrides: Partial<AddressSnapshot> & { address: string; accountId: string }): AddressSnapshot => ({
  chain: 'bitcoin',
  network: 'mainnet',
  summary: {
    aggregateState: 'proven',
    valuation: {
      quoteCurrency: 'USD',
      pricedValue: '0',
      pricedHoldingCount: 0,
      unpricedHoldingCount: 0,
      state: 'complete-priced',
    },
    sources: [],
  },
  holdings: {
    assetKey: 'bitcoin:mainnet:base:native:bitcoin',
    quantityAtomic: '0',
    valuationState: 'priced',
    value: '0',
    quoteCurrency: 'USD',
    sourceState: 'proven',
    protocol: 'base',
    assetType: 'native',
    accountId: overrides.accountId,
    locations: [],
  },
  ...overrides,
});

const event = (overrides: Partial<PortfolioEventInput>): PortfolioEventInput => ({
  chain: 'bitcoin',
  network: 'mainnet',
  txid: 'tx',
  eventType: 'receive',
  direction: 'in',
  confirmationState: 'confirmed',
  timestamp: null,
  blockHeightAtomic: null,
  nativeValueAtomic: '1000',
  feeAtomic: null,
  accountId: 'a',
  address: 'bc1qa',
  counterparties: [],
  assetKeys: ['bitcoin:mainnet:base:native:bitcoin'],
  sourceState: 'proven',
  ...overrides,
});

describe('portfolio aggregation', () => {
  it('counts one address summary once across native and protocol asset snapshots', () => {
    const base = snapshot({ address: 'a', accountId: 'one' });
    const summary = { ...base.summary, valuation: { ...base.summary.valuation, pricedValue: '30' } };
    const result = aggregatePortfolio([
      { ...base, summary, holdings: { ...base.holdings, value: '10' } },
      { ...base, summary, holdings: { ...base.holdings, assetKey: 'bitcoin:mainnet:op20:token:T', protocol: 'op20', value: '20' } },
    ]);
    expect(result.pricedTotal).toBe('30');
    expect(result.byAccount[0]).toMatchObject({ pricedValue: '30', holdingCount: 2 });
  });

  it('keeps exact native flows on separate chain and network rows', () => {
    const bitcoin = snapshot({ address: 'a', accountId: 'one' });
    const dogecoin = { ...snapshot({ address: 'b', accountId: 'two' }), chain: 'dogecoin' };
    const result = aggregatePortfolio([bitcoin, dogecoin], [
      event({ chain: 'bitcoin', address: 'a', accountId: 'one', nativeValueAtomic: '9007199254740993' }),
      event({ chain: 'dogecoin', address: 'b', accountId: 'two', nativeValueAtomic: '200000000' }),
    ]);
    expect(result.externalInflowAtomic).toBeNull();
    expect(result.nativeFlows).toMatchObject([
      { asset: 'BTC', inflow: '9007199254740993' }, { asset: 'DOGE', inflow: '200000000' },
    ]);
  });
  it('merges the same asset across accounts with exact sums', () => {
    const result = aggregatePortfolio([
      snapshot({ address: 'bc1qa', accountId: 'a', holdings: { ...snapshot({ address: 'bc1qa', accountId: 'a' }).holdings, quantityAtomic: '100000', value: '25' } }),
      snapshot({ address: 'bc1qb', accountId: 'b', holdings: { ...snapshot({ address: 'bc1qb', accountId: 'b' }).holdings, quantityAtomic: '250000', value: '62.5' } }),
    ]);
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].quantityAtomic).toBe('350000');
    expect(result.holdings[0].pricedValue).toBe('87.5');
    expect(result.holdings[0].accountIds).toEqual(['a', 'b']);
    expect(result.pricedTotal).toBe('87.5');
  });

  it('keeps chains structurally separate', () => {
    const result = aggregatePortfolio([
      snapshot({ address: 'bc1qa', accountId: 'a' }),
      {
        ...snapshot({ address: 'DExample111', accountId: 'b' }),
        chain: 'dogecoin',
        holdings: {
          ...snapshot({ address: 'DExample111', accountId: 'b' }).holdings,
          chain: 'dogecoin',
          assetKey: 'dogecoin:mainnet:base:native:dogecoin',
        },
      },
    ]);
    expect(result.holdings).toHaveLength(2);
  });

  it('counts a duplicated address once and names it', () => {
    const result = aggregatePortfolio([
      snapshot({ address: 'bc1qdup', accountId: 'a', holdings: { ...snapshot({ address: 'bc1qdup', accountId: 'a' }).holdings, quantityAtomic: '5000', value: '1' } }),
      snapshot({ address: 'bc1qdup', accountId: 'b' }),
    ]);
    expect(result.duplicateAddresses).toEqual(['bc1qdup']);
    expect(result.holdings[0].quantityAtomic).toBe('5000'); // never double-counted
  });

  it('honors an explicit inclusion policy', () => {
    const result = aggregatePortfolio(
      [
        snapshot({ address: 'bc1qdup', accountId: 'a' }),
        snapshot({ address: 'bc1qdup', accountId: 'b', holdings: { ...snapshot({ address: 'bc1qdup', accountId: 'b' }).holdings, quantityAtomic: '7000', value: '2' } }),
      ],
      [],
      { inclusionPolicy: { bc1qdup: 'b' } },
    );
    expect(result.duplicateAddresses).toEqual([]);
    expect(result.holdings[0].quantityAtomic).toBe('7000');
    expect(result.holdings[0].accountIds).toEqual(['b']);
  });

  it('folds source states pessimistically', () => {
    const result = aggregatePortfolio([
      snapshot({ address: 'bc1qa', accountId: 'a', summary: { ...snapshot({ address: 'bc1qa', accountId: 'a' }).summary, aggregateState: 'unavailable' } }),
      snapshot({ address: 'bc1qb', accountId: 'b' }),
    ]);
    expect(result.state).toBe('unavailable');
  });

  it('keeps unknown quantities out of proven sums', () => {
    const result = aggregatePortfolio([
      snapshot({
        address: 'bc1qa',
        accountId: 'a',
        holdings: { ...snapshot({ address: 'bc1qa', accountId: 'a' }).holdings, quantityAtomic: null },
      }),
    ]);
    expect(result.holdings[0].quantityAtomic).toBeNull();
    expect(result.unknownValueBucket).toBe('present');
  });
});

describe('internal transfer detection', () => {
  it('does not infer owned movement from transaction ID alone', () => {
    expect(detectInternalTransfers([
      event({ direction: 'out', nativeValueAtomic: '-1100', feeAtomic: '100', accountId: 'a' }),
      event({ direction: 'in', nativeValueAtomic: '1000', accountId: 'b' }),
    ])).toEqual([]);
  });
  it('matches an outflow and inflow inside one confirmed transaction', () => {
    const transfers = detectInternalTransfers([
      event({ txid: 'tx1', direction: 'out', nativeValueAtomic: '-50300', accountId: 'a', feeAtomic: '300', address: 'a', counterparties: ['b'] }),
      event({ txid: 'tx1', direction: 'in', nativeValueAtomic: '50000', accountId: 'b', address: 'b', counterparties: ['a'] }),
    ]);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      fromAccountId: 'a',
      toAccountId: 'b',
      quantityAtomic: '50000',
      feeAtomic: '300',
    });
  });

  it('excludes internal transfers from external flow totals', () => {
    const events = [
      event({ txid: 'tx1', direction: 'out', nativeValueAtomic: '-50000', accountId: 'a', feeAtomic: '0', address: 'a', counterparties: ['b'] }),
      event({ txid: 'tx1', direction: 'in', nativeValueAtomic: '50000', accountId: 'b', address: 'b', counterparties: ['a'] }),
      event({ txid: 'tx2', direction: 'in', nativeValueAtomic: '7000', accountId: 'b' }),
    ];
    const internal = detectInternalTransfers(events);
    const keys = new Set(internal.map((t) => `${t.chain}:${t.network}:${t.txid}`));
    const flows = externalFlows(events, keys);
    expect(flows.inflow).toBe('7000');
    expect(flows.outflow).toBe('0');
  });

  it('never calls unconfirmed movements internal', () => {
    const transfers = detectInternalTransfers([
      event({ txid: 'tx1', direction: 'out', confirmationState: 'mempool', accountId: 'a' }),
      event({ txid: 'tx1', direction: 'in', confirmationState: 'mempool', accountId: 'b' }),
    ]);
    expect(transfers).toHaveLength(0);
  });
});
