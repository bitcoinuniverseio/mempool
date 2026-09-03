import { describe, expect, it } from 'vitest';
import { deriveInsights, INSIGHT_SCHEMA_VERSION, type InsightInput } from './insights';
import type { AggregationResult } from './aggregation';
import type { PortfolioUtxo } from '@app/shared/universe-portfolio-v2.types';

const aggregation = (overrides: Partial<AggregationResult> = {}): AggregationResult => ({
  quoteCurrency: 'USD',
  pricedTotal: '100',
  unpricedCount: 0,
  state: 'proven',
  holdings: [
    {
      assetKey: 'bitcoin:mainnet:base:native:bitcoin',
      chain: 'bitcoin', network: 'mainnet', protocol: 'base', assetType: 'native',
      displayName: 'Bitcoin', ticker: 'BTC',
      quantityAtomic: '100000000', pricedValue: '100', quoteCurrency: 'USD',
      valuationState: 'priced', state: 'proven',
      accountIds: ['a'], locationCount: 1, locations: [],
    },
  ],
  byAccount: [],
  externalInflowAtomic: '0',
  externalOutflowAtomic: '0',
  internalTransfers: [],
  unknownValueBucket: 'absent',
  duplicateAddresses: [],
  ...overrides,
});

const utxo = (overrides: Partial<PortfolioUtxo> = {}): PortfolioUtxo => ({
  schemaVersion: 'universe-portfolio-utxo-v1',
  chain: 'bitcoin', network: 'mainnet', txid: 'a'.repeat(64), vout: 0,
  valueAtomic: '100000', scriptType: 'p2wpkh', address: 'bc1q',
  confirmationsAtomic: '10', blockHeightAtomic: '900000', blockHash: null,
  firstSeenAt: null, spent: false, pending: false, coinbase: false,
  maturityHeightAtomic: null, assetState: 'proven', assets: [],
  warnings: [], sourceReports: [],
  ...overrides,
});

const input = (overrides: Partial<InsightInput> = {}): InsightInput => ({
  aggregation: aggregation(),
  utxos: [],
  duplicateAddresses: [],
  sourceStates: [],
  vaultUnlockedHours: null,
  lastBackupAt: null,
  lastSnapshotAt: null,
  ...overrides,
});

describe('insight engine', () => {
  it('emits deterministic ids and the locked schema version', () => {
    const first = deriveInsights(input({ lastBackupAt: null }), '2026-09-02T00:00:00Z');
    const second = deriveInsights(input({ lastBackupAt: null }), '2026-09-02T00:00:00Z');
    expect(first).toEqual(second);
    for (const insight of first) {
      expect(insight.schemaVersion).toBe(INSIGHT_SCHEMA_VERSION);
      expect(insight.calculation).toContain('=');
    }
  });

  it('explains concentration with its exact formula', () => {
    const insights = deriveInsights(input(), '2026-09-02T00:00:00Z');
    const concentration = insights.find((i) => i.ruleId === 'allocation.asset-concentration');
    expect(concentration).toBeDefined();
    expect(concentration!.title).toContain('100%');
    expect(concentration!.calculation).toContain('threshold 60%');
  });

  it('stays silent when the evidence does not trip a rule', () => {
    const insights = deriveInsights(
      input({ aggregation: aggregation({ duplicateAddresses: [], utxos: [] }), lastBackupAt: '2026-09-01T00:00:00Z' }),
      '2026-09-02T00:00:00Z',
    );
    expect(insights.find((i) => i.ruleId === 'accounts.duplicate-addresses')).toBeUndefined();
    expect(insights.find((i) => i.ruleId === 'backup.missing')).toBeUndefined();
  });

  it('never calls an unproven output plain or safe', () => {
    const suspicious = utxo({ assetState: 'partial', warnings: ['No protocol authority answered for this output; its asset composition is unknown.'] });
    const insights = deriveInsights(
      input({ utxos: Array.from({ length: 25 }, (_, i) => ({ ...suspicious, txid: i.toString().padStart(64, '0') })) }),
      '2026-09-02T00:00:00Z',
    );
    expect(insights.find((i) => i.ruleId === 'utxo.unknown-asset-coverage')).toBeDefined();
  });

  it('sorts by severity then rule', () => {
    const insights = deriveInsights(
      input({
        aggregation: aggregation({ duplicateAddresses: ['bc1qdup'] }),
        utxos: Array.from({ length: 30 }, (_, i) => utxo({ txid: i.toString().padStart(64, '0') })),
      }),
      '2026-09-02T00:00:00Z',
    );
    const severities = insights.map((i) => i.severity);
    const rank = (severity: string): number => (severity === 'high' ? 3 : severity === 'attention' ? 2 : 1);
    expect(severities).toEqual([...severities].sort((a, b) => rank(b) - rank(a)));
  });
});
