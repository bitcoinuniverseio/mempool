import { beforeEach, describe, expect, it } from 'vitest';
import { PortfolioAlertsService } from '@app/universe/portfolio/portfolio-alerts.service';
import { StateService } from '@app/services/state.service';
import {
  PortfolioProtocolStatement,
  PortfolioSourceState,
  PortfolioSummary,
} from '@app/universe/portfolio/portfolio.types';

function installStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: () => null,
    length: 0,
  };
}

function service(): PortfolioAlertsService {
  return new PortfolioAlertsService({ isBrowser: true } as StateService);
}

function statement(
  protocol: string,
  state: PortfolioSourceState,
  assetIds: string[],
): PortfolioProtocolStatement {
  return {
    protocol,
    chain: 'bitcoin',
    network: 'mainnet',
    state,
    holdings: assetIds.map((assetId) => ({
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
      quantityAtomic: '100',
      custody: [],
      ownerAddress: 'bc1qtest',
      state: 'active',
      valuationState: 'unpriced',
      costBasisState: 'unknown',
      sourceAuthority: 'test',
      sourceState: 'proven',
      checkpoint: null,
      warnings: [],
    })),
    authorityId: 'test',
    checkpoint: null,
    truncated: false,
    warnings: [],
  } as unknown as PortfolioProtocolStatement;
}

function summary(
  protocols: PortfolioProtocolStatement[],
  snapshotId: string,
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

describe('PortfolioAlertsService', () => {
  beforeEach(() => {
    installStorage();
    (globalThis as { Notification?: unknown }).Notification = undefined;
  });

  it('raises nothing on the first evaluation, which is the baseline', () => {
    const alerts = service().evaluate(
      'bitcoin',
      'mainnet',
      'bc1qtest',
      summary([statement('runes', 'proven', ['a'])], 'snap-1'),
    );
    expect(alerts).toEqual([]);
  });

  it('raises a change against the stored baseline on the next evaluation', () => {
    const alerts = service();
    alerts.evaluate('bitcoin', 'mainnet', 'bc1qtest', summary([statement('runes', 'proven', [])], 'snap-1'));
    const raised = alerts.evaluate(
      'bitcoin',
      'mainnet',
      'bc1qtest',
      summary([statement('runes', 'proven', ['a'])], 'snap-2'),
    );
    expect(raised).toHaveLength(1);
    expect(raised[0].kind).toBe('asset-received');
  });

  it('never raises the same alert twice', () => {
    const alerts = service();
    const before = summary([statement('runes', 'proven', [])], 'snap-1');
    const after = summary([statement('runes', 'proven', ['a'])], 'snap-2');
    alerts.evaluate('bitcoin', 'mainnet', 'bc1qtest', before);
    expect(alerts.evaluate('bitcoin', 'mainnet', 'bc1qtest', after)).toHaveLength(1);
    // Re-evaluating the same pair produces nothing: the id was recorded.
    alerts.evaluate('bitcoin', 'mainnet', 'bc1qtest', before);
    expect(alerts.evaluate('bitcoin', 'mainnet', 'bc1qtest', after)).toHaveLength(0);
  });

  it('keeps baselines separate per chain, so one address on two chains does not cross', () => {
    const alerts = service();
    alerts.evaluate('bitcoin', 'mainnet', 'bc1qtest', summary([statement('runes', 'proven', ['a'])], 'snap-1'));
    // Fractal has never been seen, so its first evaluation is a baseline
    // rather than a flood of departures.
    const fractal = alerts.evaluate(
      'fractal',
      'mainnet',
      'bc1qtest',
      summary([statement('cat20', 'proven', [])], 'snap-2'),
    );
    expect(fractal).toEqual([]);
  });

  it('persists and validates the rule', () => {
    const alerts = service();
    alerts.setRule({ kinds: ['asset-sent'], minimumChangeRatio: '0.25' });
    expect(alerts.currentRule()).toEqual({
      kinds: ['asset-sent'],
      minimumChangeRatio: '0.25',
    });
    // A fresh instance reads the same store.
    expect(service().currentRule().minimumChangeRatio).toBe('0.25');
  });

  it('drops an unusable stored rule rather than trusting it', () => {
    localStorage.setItem(
      'universe.portfolio.alert-rule.v1',
      JSON.stringify({ kinds: ['drop-tables', 'asset-sent'], minimumChangeRatio: 'nonsense' }),
    );
    const rule = service().currentRule();
    expect(rule.kinds).toEqual(['asset-sent']);
    expect(rule.minimumChangeRatio).toBe('');
  });

  it('honours the rule when deciding', () => {
    const alerts = service();
    alerts.setRule({ kinds: ['source-degraded'], minimumChangeRatio: '' });
    alerts.evaluate('bitcoin', 'mainnet', 'bc1qtest', summary([statement('runes', 'proven', [])], 'snap-1'));
    const raised = alerts.evaluate(
      'bitcoin',
      'mainnet',
      'bc1qtest',
      summary([statement('runes', 'proven', ['a'])], 'snap-2'),
    );
    // A received asset is not a degradation, and only degradations were asked for.
    expect(raised).toEqual([]);
  });

  it('reports notifications ungranted when the browser has no Notification', () => {
    expect(service().notificationsGranted()).toBe(false);
  });

  it('does nothing at all outside a browser', () => {
    const alerts = new PortfolioAlertsService({ isBrowser: false } as StateService);
    expect(
      alerts.evaluate('bitcoin', 'mainnet', 'bc1qtest', summary([statement('runes', 'proven', ['a'])], 'snap-1')),
    ).toEqual([]);
  });

  it('publishes raised alerts on its stream and can clear them', () => {
    const alerts = service();
    let latest: readonly unknown[] = [];
    alerts.alerts$.subscribe((value) => { latest = value; });
    alerts.evaluate('bitcoin', 'mainnet', 'bc1qtest', summary([statement('runes', 'proven', [])], 'snap-1'));
    alerts.evaluate('bitcoin', 'mainnet', 'bc1qtest', summary([statement('runes', 'proven', ['a'])], 'snap-2'));
    expect(latest).toHaveLength(1);
    alerts.dismissAll();
    expect(latest).toHaveLength(0);
  });
});
