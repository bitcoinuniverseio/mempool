import { describe, expect, it } from 'vitest';
import {
  allHoldings,
  emptyMeansEmpty,
  mergeSummaries,
  sortHoldings,
  sourceStateCopy,
  worseState,
} from '@app/universe/portfolio/portfolio-view';
import { interpretAddress } from '@app/universe/portfolio/portfolio-lookup.component';
import {
  PortfolioHolding,
  PortfolioProtocolStatement,
  PortfolioSummary,
} from '@app/universe/portfolio/portfolio.types';

function holding(overrides: Partial<PortfolioHolding> & { assetKey: string }): PortfolioHolding {
  return {
    schemaVersion: 'universe-portfolio-holding-v1',
    identity: {
      chain: 'bitcoin',
      network: 'mainnet',
      protocol: 'runes',
      assetType: 'fungible',
      assetId: overrides.assetKey.split(':').slice(4).join(':'),
    },
    quantityAtomic: '1',
    custody: [],
    ownerAddress: 'bc1qtest',
    state: 'active',
    valuationState: 'unpriced',
    costBasisState: 'unknown',
    sourceAuthority: 'ord',
    sourceState: 'proven',
    checkpoint: null,
    warnings: [],
    ...overrides,
  };
}

function statement(
  protocol: string,
  holdings: PortfolioHolding[],
  overrides: Partial<PortfolioProtocolStatement> = {},
): PortfolioProtocolStatement {
  return {
    protocol,
    chain: 'bitcoin',
    network: 'mainnet',
    state: 'proven',
    holdings,
    authorityId: 'ord',
    checkpoint: null,
    truncated: false,
    warnings: [],
    ...overrides,
  };
}

function summary(
  statements: PortfolioProtocolStatement[],
  overrides: Partial<PortfolioSummary> = {},
): PortfolioSummary {
  return {
    envelope: {
      schemaVersion: 'universe-portfolio-v1',
      chain: 'bitcoin',
      network: 'mainnet',
      address: 'bc1qtest',
      requestedAt: '2026-08-31T00:00:00.000Z',
      completedAt: '2026-08-31T00:00:01.000Z',
      snapshotId: 'snap',
      chainTip: null,
      sources: [],
      warnings: [],
      errors: [],
      unresolvedCount: 0,
      hasMore: false,
    },
    nativeBalance: null,
    totalHoldingCount: statements.reduce((count, entry) => count + entry.holdings.length, 0),
    fungibleCount: 0,
    nftCount: 0,
    inscriptionCount: 0,
    protocolCount: statements.filter((entry) => entry.holdings.length > 0).length,
    valuation: {
      quoteCurrency: 'USD',
      pricedValue: '0',
      pricedHoldingCount: 0,
      unpricedHoldingCount: 0,
      state: 'unpriced',
    },
    protocols: statements,
    ...overrides,
  };
}

describe('worseState', () => {
  it('lets a worse claim survive a better one in both directions', () => {
    expect(worseState('proven', 'unavailable')).toBe('unavailable');
    expect(worseState('unavailable', 'proven')).toBe('unavailable');
    expect(worseState('partial', 'proven')).toBe('partial');
    expect(worseState('proven', 'proven')).toBe('proven');
  });
});

describe('mergeSummaries', () => {
  const KEY = 'bitcoin:mainnet:runes:fungible:840000:1';

  it('folds an asset met on two pages with exact arithmetic', () => {
    const merged = mergeSummaries(
      summary([statement('runes', [holding({
        assetKey: KEY,
        quantityAtomic: '18446744073709551615',
        custody: [{ kind: 'outpoint', reference: 'a'.repeat(64) + ':0' }],
      })])]),
      summary([statement('runes', [holding({
        assetKey: KEY,
        quantityAtomic: '1',
        custody: [{ kind: 'outpoint', reference: 'b'.repeat(64) + ':0' }],
      })])]),
    );
    const runes = merged.protocols.find((entry) => entry.protocol === 'runes');
    expect(runes?.holdings).toHaveLength(1);
    expect(runes?.holdings[0].quantityAtomic).toBe('18446744073709551616');
    expect(runes?.holdings[0].custody).toHaveLength(2);
  });

  it('makes a merged quantity null when either page lacked one', () => {
    const merged = mergeSummaries(
      summary([statement('runes', [holding({ assetKey: KEY, quantityAtomic: null })])]),
      summary([statement('runes', [holding({ assetKey: KEY, quantityAtomic: '5' })])]),
    );
    expect(merged.protocols[0].holdings[0].quantityAtomic).toBeNull();
  });

  it('keeps the worse of the two states', () => {
    const merged = mergeSummaries(
      summary([statement('runes', [], { state: 'partial' })]),
      summary([statement('runes', [], { state: 'proven' })]),
    );
    expect(merged.protocols[0].state).toBe('partial');
  });

  it('keeps a protocol absent from the continuation page', () => {
    const merged = mergeSummaries(
      summary([
        statement('runes', [holding({ assetKey: KEY })]),
        statement('ordinals', [holding({ assetKey: 'bitcoin:mainnet:ordinals:inscription:' + 'c'.repeat(64) + 'i0' })]),
      ]),
      summary([statement('runes', [])]),
    );
    expect(merged.protocols.map((entry) => entry.protocol).sort()).toEqual(['ordinals', 'runes']);
  });
});

describe('sortHoldings and allHoldings', () => {
  it('puts the native balance first and larger quantities before smaller', () => {
    const native = holding({
      assetKey: 'bitcoin:mainnet:bitcoin:native:btc',
      identity: {
        chain: 'bitcoin', network: 'mainnet', protocol: 'bitcoin',
        assetType: 'native', assetId: 'btc',
      },
      quantityAtomic: '1',
    });
    const small = holding({ assetKey: 'bitcoin:mainnet:runes:fungible:1:1', quantityAtomic: '5' });
    const large = holding({ assetKey: 'bitcoin:mainnet:runes:fungible:2:2', quantityAtomic: '500' });
    const sorted = sortHoldings(allHoldings(summary(
      [statement('runes', [small, large])],
      { nativeBalance: native },
    )));
    expect(sorted[0].identity.assetType).toBe('native');
    expect(sorted[1].quantityAtomic).toBe('500');
    expect(sorted[2].quantityAtomic).toBe('5');
  });
});

describe('state copy', () => {
  it('states the §23 vocabulary rather than developer words', () => {
    expect(sourceStateCopy('unavailable')).toContain('did not answer');
    expect(sourceStateCopy('unsupported')).toContain('Not served');
    expect(sourceStateCopy('partial')).toContain('incomplete');
  });

  it('treats only a proven answer as a real empty', () => {
    expect(emptyMeansEmpty('proven')).toBe(true);
    expect(emptyMeansEmpty('unavailable')).toBe(false);
    expect(emptyMeansEmpty('unsupported')).toBe(false);
  });
});

describe('interpretAddress', () => {
  it('offers Bitcoin and Fractal side by side for a Taproot-style string', () => {
    const readings = interpretAddress('bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y');
    expect(readings.map((reading) => reading.chain)).toEqual(['bitcoin', 'fractal']);
  });

  it('reads a D-prefixed base58 string as Dogecoin only', () => {
    const readings = interpretAddress('D8vFz4p1L37jdg47HXKtSHA2usuvz9nxvd');
    expect(readings.map((reading) => reading.chain)).toEqual(['dogecoin']);
  });

  it('reads transparent and shielded strings as Zcash', () => {
    expect(interpretAddress('t1KGBcVbGvcVI1234567890abcdefghijk')[0]?.chain).toBe('zcash');
    expect(interpretAddress('zs1' + 'q'.repeat(60))[0]?.chain).toBe('zcash');
  });

  it('offers nothing for a string no chain can read', () => {
    expect(interpretAddress('hello world')).toEqual([]);
    expect(interpretAddress('')).toEqual([]);
  });
});
