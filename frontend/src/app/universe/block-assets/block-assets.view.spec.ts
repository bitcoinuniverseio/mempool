import { BlockAssetActivitySummary, BlockAssetEvent, BlockProtocolCoverage } from '@app/universe/universe.types';
import {
  assetRoute,
  breakdownRows,
  coverageNotices,
  emptyStateMessage,
  limitedRows,
  quantityLabel,
  transactionRoute,
} from './block-assets.view';

const coverage = (overrides: Partial<BlockProtocolCoverage>): BlockProtocolCoverage => ({
  protocolId: 'runes',
  displayName: 'Runes',
  family: 'fungible',
  releaseStatus: 'VERIFIED READ ONLY',
  state: 'read',
  reason: null,
  authorityId: 'ord',
  negativeCompleteness: true,
  transactionCountAtomic: '0',
  eventCountAtomic: '0',
  checkpoint: null,
  ...overrides,
});

const summary = (overrides: Partial<BlockAssetActivitySummary> = {}): BlockAssetActivitySummary => ({
  schemaVersion: 'universe-block-asset-activity-v1',
  chain: 'bitcoin',
  network: 'mainnet',
  block: { heightAtomic: '900000', hash: 'a'.repeat(64), canonical: true },
  generatedAt: '2026-10-16T00:00:00.000Z',
  completeness: 'complete',
  progress: { processedTransactionsAtomic: '3', totalTransactionsAtomic: '3' },
  counts: {
    transactionsAtomic: '3',
    assetBearingTransactionsAtomic: '0',
    distinctAssetsAtomic: '0',
    transfersAtomic: '0',
    creationsAtomic: '0',
    burnsAtomic: '0',
    otherOperationsAtomic: '0',
    outputPositionsAtomic: '0',
    protocolsWithActivityAtomic: '0',
  },
  protocols: [coverage({})],
  outOfCoverageOutputsAtomic: '0',
  unresolvedOutputsAtomic: '0',
  privacy: null,
  retryAfterSeconds: null,
  ...overrides,
});

describe('block asset view', () => {
  it('claims an empty block only when every protocol proved absence', () => {
    expect(emptyStateMessage(summary())).toContain('Every supported protocol proved it');
    expect(emptyStateMessage(summary({ completeness: 'partial' }))).toContain('may still exist');
  });

  it('states unavailable and unreadable sources instead of hiding them', () => {
    const notices = coverageNotices(summary({
      completeness: 'partial',
      protocols: [
        coverage({ protocolId: 'a', state: 'unavailable' }),
        coverage({ protocolId: 'b', state: 'unavailable' }),
        coverage({ protocolId: 'c', state: 'not-block-readable' }),
      ],
    }));
    expect(notices.map((notice) => notice.text)).toEqual([
      'Asset activity is partially indexed. 2 protocol sources are currently unavailable.',
      expect.stringContaining('1 supported protocols cannot be read by block yet'),
    ]);
  });

  it('warns first when the block left the main chain', () => {
    const notices = coverageNotices(summary({ block: { heightAtomic: '1', hash: 'b'.repeat(64), canonical: false } }));
    expect(notices[0]).toEqual(expect.objectContaining({ tone: 'warning' }));
  });

  it('keeps exact quantities beyond the safe integer range', () => {
    const event = {
      quantityAtomic: '123456789012345678901234567890',
      asset: { protocolId: 'runes', assetId: '1:1', assetKind: 'fungible', decimals: 2 },
    } as unknown as BlockAssetEvent;
    expect(quantityLabel(event)).toBe('1,234,567,890,123,456,789,012,345,678.9');
  });

  it('routes assets and transactions to each chain\'s own pages', () => {
    expect(assetRoute('bitcoin', { protocolId: 'ordinals', assetId: 'x', assetKind: 'inscription' })).toEqual(['/inscription', 'x']);
    expect(assetRoute('bitcoin', { protocolId: 'atomicals_nft', assetId: 'x', assetKind: 'non-fungible' })).toBeNull();
    expect(assetRoute('zcash', { protocolId: 'zrunes', assetId: '1:2', assetKind: 'fungible' }))
      .toEqual(['/', 'zcash', 'protocols', 'zrunes', '1:2']);
    expect(transactionRoute('dogecoin', 'f')).toEqual(['/', 'dogecoin', 'tx', 'f']);
  });

  it('splits protocols with activity from coverage limits', () => {
    const value = summary({
      protocols: [
        coverage({ protocolId: 'runes', displayName: 'Runes', eventCountAtomic: '9' }),
        coverage({ protocolId: 'ordinals', displayName: 'Ordinals', eventCountAtomic: '10' }),
        coverage({ protocolId: 'brc20', displayName: 'BRC-20', state: 'not-block-readable' }),
      ],
    });
    expect(breakdownRows(value).map((row) => row.protocolId)).toEqual(['ordinals', 'runes']);
    expect(limitedRows(value).map((row) => row.protocolId)).toEqual(['brc20']);
  });
});
