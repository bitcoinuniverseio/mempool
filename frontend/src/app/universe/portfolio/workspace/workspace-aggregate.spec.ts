import { describe, expect, it } from 'vitest';

import {
  addAtomic,
  addDecimalStrings,
  aggregateCsv,
  aggregateJson,
  aggregateWorkspace,
} from './workspace-aggregate';
import { WatchedAddress } from '@app/universe/portfolio/portfolio-watchlist.service';
import { PortfolioSummary } from '@app/universe/portfolio/portfolio.types';

const entry = (overrides: Partial<WatchedAddress> = {}): WatchedAddress => ({
  chain: 'bitcoin',
  network: 'mainnet',
  address: 'bc1qexample000000000000',
  label: 'cold storage',
  group: 'savings',
  at: 0,
  ...overrides,
});

const summary = (overrides: Partial<PortfolioSummary> = {}): PortfolioSummary => ({
  envelope: {
    schemaVersion: 'v1', chain: 'bitcoin', network: 'mainnet', address: 'x',
    requestedAt: '', completedAt: '', snapshotId: '',
    chainTip: null, sources: [], warnings: [], errors: [], unresolvedCount: 0, hasMore: false,
  },
  nativeBalance: null,
  totalHoldingCount: 0,
  fungibleCount: 0,
  nftCount: 0,
  inscriptionCount: 0,
  protocolCount: 0,
  valuation: { quoteCurrency: 'usd', pricedValue: '0', pricedHoldingCount: 0, unpricedHoldingCount: 0, state: 'unpriced' },
  protocols: [],
  ...overrides,
});

const ready = summary({
  nativeBalance: { quantityAtomic: '150000' } as any,
  totalHoldingCount: 4,
  valuation: { quoteCurrency: 'usd', pricedValue: '101.25', pricedHoldingCount: 4, unpricedHoldingCount: 0, state: 'complete-priced' },
});
const readyOther = summary({
  nativeBalance: { quantityAtomic: '250000' } as any,
  totalHoldingCount: 1,
  valuation: { quoteCurrency: 'usd', pricedValue: '98.75', pricedHoldingCount: 1, unpricedHoldingCount: 0, state: 'partially-priced' },
});

describe('addDecimalStrings', () => {
  it('aligns scales and keeps every digit', () => {
    expect(addDecimalStrings('1.5', '2.25')).toBe('3.75');
    expect(addDecimalStrings('0.001', '0.002')).toBe('0.003');
    expect(addDecimalStrings('2', '3')).toBe('5');
  });

  it('never loses cents to representation', () => {
    expect(addDecimalStrings('0.1', '0.2')).toBe('0.3');
  });

  it('answers zero rather than a made up number for malformed input', () => {
    expect(addDecimalStrings('abc', '1')).toBe('0');
    expect(addDecimalStrings('-5', '1')).toBe('0');
  });
});

describe('addAtomic', () => {
  it('sums exact integers beyond safe range', () => {
    expect(addAtomic('9007199254740993', '1')).toBe('9007199254740994');
    expect(addAtomic('21000000000000000000000000', '1')).toBe('21000000000000000000000001');
  });
});

describe('aggregateWorkspace', () => {
  const failed = summary();

  it('sums native balances per chain as exact integers', () => {
    const watched = [
      entry({ address: 'A' }),
      entry({ address: 'B', chain: 'dogecoin' }),
      entry({ address: 'C' }),
    ];
    const results = new Map([
      ['bitcoin:mainnet:A', { summary: ready, reason: null }],
      ['dogecoin:mainnet:B', { summary: readyOther, reason: null }],
      ['bitcoin:mainnet:C', { summary: readyOther, reason: null }],
    ]);
    const aggregate = aggregateWorkspace(results, watched);
    const bitcoin = aggregate.nativeTotals.find((total) => total.key === 'bitcoin');
    expect(bitcoin?.atomic).toBe('400000');
    expect(bitcoin?.addresses).toBe(2);
  });

  it('adds valuations only within their own quote currency', () => {
    const watched = [entry({ address: 'A' }), entry({ address: 'B' })];
    const euro = summary({
      nativeBalance: { quantityAtomic: '1' } as any,
      valuation: { quoteCurrency: 'eur', pricedValue: '50.00', pricedHoldingCount: 1, unpricedHoldingCount: 0, state: 'complete-priced' },
    });
    const results = new Map([
      ['bitcoin:mainnet:A', { summary: ready, reason: null }],
      ['bitcoin:mainnet:B', { summary: euro, reason: null }],
    ]);
    const aggregate = aggregateWorkspace(results, watched);
    expect(aggregate.valuations.map((total) => total.quoteCurrency).sort()).toEqual(['eur', 'usd']);
    expect(aggregate.valuations.find((total) => total.quoteCurrency === 'usd')?.value).toBe('101.25');
  });

  it('lists a failed authority with its reason and never as a zero', () => {
    const watched = [entry({ address: 'A' }), entry({ address: 'B' })];
    const results = new Map([
      ['bitcoin:mainnet:A', { summary: ready, reason: null }],
      ['bitcoin:mainnet:B', { summary: null, reason: 'deadline' }],
    ]);
    const aggregate = aggregateWorkspace(results, watched);
    expect(aggregate.failedCount).toBe(1);
    expect(aggregate.outcomes[1].reason).toBe('deadline');
    const bitcoin = aggregate.nativeTotals.find((total) => total.key === 'bitcoin');
    expect(bitcoin?.atomic).toBe('150000');
    expect(bitcoin?.addresses).toBe(1);
  });

  it('keeps group subtotals in the groups the visitor named', () => {
    const watched = [
      entry({ address: 'A', group: 'savings' }),
      entry({ address: 'B', group: '' }),
    ];
    const results = new Map([
      ['bitcoin:mainnet:A', { summary: ready, reason: null }],
      ['bitcoin:mainnet:B', { summary: readyOther, reason: null }],
    ]);
    const aggregate = aggregateWorkspace(results, watched);
    expect(aggregate.groupTotals.get('savings')?.[0]?.atomic).toBe('150000');
    expect(aggregate.groupTotals.get('ungrouped')?.[0]?.atomic).toBe('250000');
  });
});

describe('exports', () => {
  it('writes one CSV row per watched address', () => {
    const watched = [entry({ address: 'A' })];
    const results = new Map([['bitcoin:mainnet:A', { summary: ready, reason: null }]]);
    const csv = aggregateCsv(aggregateWorkspace(results, watched));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('address,chain,network,group,native_atomic,holdings,value,quote');
    expect(lines[1]).toContain('150000');
  });

  it('exports versioned JSON with the failure reasons in it', () => {
    const watched = [entry({ address: 'A' })];
    const results = new Map([['bitcoin:mainnet:A', { summary: null, reason: 'deadline' }]]);
    const parsed = JSON.parse(aggregateJson(aggregateWorkspace(results, watched)));
    expect(parsed.schemaVersion).toBe('universe-portfolio-workspace-v1');
    expect(parsed.outcomes[0].reason).toBe('deadline');
  });
});
