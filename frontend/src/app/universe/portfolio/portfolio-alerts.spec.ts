import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERT_RULE,
  decideAlerts,
} from '@app/universe/portfolio/portfolio-alerts';
import {
  PortfolioHolding,
  PortfolioProtocolStatement,
  PortfolioSourceState,
  PortfolioSummary,
} from '@app/universe/portfolio/portfolio.types';

function holding(
  protocol: string,
  assetId: string,
  quantityAtomic: string | null = '100',
): PortfolioHolding {
  return {
    schemaVersion: 'universe-portfolio-holding-v1',
    assetKey: `bitcoin:mainnet:${protocol}:fungible:${assetId}`,
    identity: {
      chain: 'bitcoin',
      network: 'mainnet',
      protocol,
      assetType: 'fungible',
      assetId,
    },
    displayName: assetId,
    quantityAtomic,
    custody: [],
    ownerAddress: 'bc1qtest',
    state: 'active',
    valuationState: 'unpriced',
    costBasisState: 'unknown',
    sourceAuthority: 'test',
    sourceState: 'proven',
    checkpoint: null,
    warnings: [],
  } as unknown as PortfolioHolding;
}

function statement(
  protocol: string,
  state: PortfolioSourceState,
  holdings: PortfolioHolding[],
  warnings: string[] = [],
): PortfolioProtocolStatement {
  return {
    protocol,
    chain: 'bitcoin',
    network: 'mainnet',
    state,
    holdings,
    authorityId: 'test',
    checkpoint: null,
    truncated: false,
    warnings,
  } as unknown as PortfolioProtocolStatement;
}

function summary(
  protocols: PortfolioProtocolStatement[],
  snapshotId = 'snap-1',
): PortfolioSummary {
  return {
    envelope: {
      schemaVersion: 'universe-portfolio-v1',
      chain: 'bitcoin',
      network: 'mainnet',
      address: 'bc1qtest',
      requestedAt: '2026-09-01T00:00:00.000Z',
      completedAt: '2026-09-01T00:00:01.000Z',
      snapshotId,
      chainTip: null,
      sources: [],
      warnings: [],
      errors: [],
      unresolvedCount: 0,
      hasMore: false,
    },
    nativeBalance: null,
    totalHoldingCount: 0,
    fungibleCount: 0,
    nftCount: 0,
    inscriptionCount: 0,
    protocolCount: protocols.length,
    valuation: {
      quoteCurrency: 'USD',
      pricedValue: '0',
      pricedHoldingCount: 0,
      unpricedHoldingCount: 0,
      state: 'unpriced',
    },
    protocols,
  } as unknown as PortfolioSummary;
}

describe('decideAlerts', () => {
  it('raises nothing on the first sight of an address', () => {
    const now = summary([statement('runes', 'proven', [holding('runes', 'a')])]);
    expect(decideAlerts(null, now)).toEqual([]);
  });

  it('raises nothing when nothing changed', () => {
    const before = summary([statement('runes', 'proven', [holding('runes', 'a')])]);
    const after = summary([statement('runes', 'proven', [holding('runes', 'a')])], 'snap-2');
    expect(decideAlerts(before, after)).toEqual([]);
  });

  it('reports a new holding from a source that was already answering', () => {
    const before = summary([statement('runes', 'proven', [])]);
    const after = summary(
      [statement('runes', 'proven', [holding('runes', 'a')])],
      'snap-2',
    );
    const alerts = decideAlerts(before, after);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('asset-received');
    expect(alerts[0].title).toContain('a');
  });

  it('does not call an asset new when its source was silent before', () => {
    // The asset may have been held all along and simply unseen.
    const before = summary([statement('runes', 'unavailable', [])]);
    const after = summary(
      [statement('runes', 'proven', [holding('runes', 'a')])],
      'snap-2',
    );
    expect(decideAlerts(before, after)).toEqual([]);
  });

  it('does not call an asset sent when its source stopped answering', () => {
    // This is the alert that would otherwise tell somebody their coins
    // left when in truth an indexer went down.
    const before = summary([statement('runes', 'proven', [holding('runes', 'a')])]);
    const after = summary([statement('runes', 'unavailable', [])], 'snap-2');
    const alerts = decideAlerts(before, after);
    expect(alerts.filter((alert) => alert.kind === 'asset-sent')).toEqual([]);
  });

  it('reports an asset that genuinely left while the source kept answering', () => {
    const before = summary([statement('runes', 'proven', [holding('runes', 'a')])]);
    const after = summary([statement('runes', 'proven', [])], 'snap-2');
    const alerts = decideAlerts(before, after);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('asset-sent');
  });

  it('reports a quantity change with both amounts', () => {
    const before = summary([statement('runes', 'proven', [holding('runes', 'a', '100')])]);
    const after = summary(
      [statement('runes', 'proven', [holding('runes', 'a', '250')])],
      'snap-2',
    );
    const alerts = decideAlerts(before, after);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('quantity-changed');
    expect(alerts[0].title).toContain('increased');
    expect(alerts[0].detail).toBe('100 to 250');
  });

  it('honours a minimum change threshold exactly', () => {
    const before = summary([statement('runes', 'proven', [holding('runes', 'a', '1000')])]);
    const smallChange = summary(
      [statement('runes', 'proven', [holding('runes', 'a', '1050')])],
      'snap-2',
    );
    const rule = { ...DEFAULT_ALERT_RULE, minimumChangeRatio: '0.1' };
    // Five percent is below a ten percent threshold.
    expect(decideAlerts(before, smallChange, rule)).toEqual([]);

    const bigChange = summary(
      [statement('runes', 'proven', [holding('runes', 'a', '1100')])],
      'snap-3',
    );
    // Exactly ten percent clears an inclusive threshold.
    expect(decideAlerts(before, bigChange, rule)).toHaveLength(1);
  });

  it('compares quantities exactly beyond the safe integer range', () => {
    const before = summary([
      statement('runes', 'proven', [holding('runes', 'a', '9007199254740993')]),
    ]);
    const after = summary(
      [statement('runes', 'proven', [holding('runes', 'a', '9007199254740994')])],
      'snap-2',
    );
    const alerts = decideAlerts(before, after);
    // A float comparison would see these as equal and raise nothing.
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain('increased');
  });

  it('reports a source that stopped answering in full', () => {
    const before = summary([statement('runes', 'proven', [])]);
    const after = summary(
      [statement('runes', 'unavailable', [], ['The authority did not answer.'])],
      'snap-2',
    );
    const alerts = decideAlerts(before, after);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('source-degraded');
    expect(alerts[0].detail).toContain('did not answer');
  });

  it('does not repeat a degradation that was already degraded', () => {
    const before = summary([statement('runes', 'unavailable', [])]);
    const after = summary([statement('runes', 'unavailable', [])], 'snap-2');
    expect(decideAlerts(before, after)).toEqual([]);
  });

  it('raises only the kinds the visitor asked for', () => {
    const before = summary([statement('runes', 'proven', [holding('runes', 'a')])]);
    const after = summary([statement('runes', 'proven', [])], 'snap-2');
    const rule = { ...DEFAULT_ALERT_RULE, kinds: ['source-degraded' as const] };
    expect(decideAlerts(before, after, rule)).toEqual([]);
  });

  it('gives every alert a stable identity so it is never raised twice', () => {
    const before = summary([statement('runes', 'proven', [])]);
    const after = summary(
      [statement('runes', 'proven', [holding('runes', 'a')])],
      'snap-2',
    );
    const first = decideAlerts(before, after);
    const second = decideAlerts(before, after);
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toContain('snap-2');
  });

  it('ignores a holding whose quantity was never stated', () => {
    const before = summary([statement('runes', 'proven', [holding('runes', 'a', null)])]);
    const after = summary(
      [statement('runes', 'proven', [holding('runes', 'a', '500')])],
      'snap-2',
    );
    expect(decideAlerts(before, after)).toEqual([]);
  });
});
