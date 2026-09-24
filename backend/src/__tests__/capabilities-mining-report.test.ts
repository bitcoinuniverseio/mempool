/**
 * The mining section of /api/v1/capabilities, end to end through $report with
 * the database and the Core reading replaced. The verdict itself is covered in
 * capabilities-mining.test.ts; these prove the report feeds it the right facts
 * and that a cached answer cannot outlive the state it described.
 */

interface BlockRow { total: number; lowest: number | null; highest: number | null; newest: Date | null }
const db: { up: boolean; blocks: BlockRow; pools: number } = {
  up: true,
  blocks: { total: 11_000, lowest: 957_300, highest: 968_299, newest: new Date('2026-09-23T17:55:00.000Z') },
  pools: 180,
};
const sync: { value: Record<string, unknown> | null } = { value: null };

jest.mock('../database', () => ({
  __esModule: true,
  default: {
    query: async (sql: string) => {
      if (!db.up) {throw new Error('connect ECONNREFUSED');}
      if (sql.includes('SELECT 1')) {return [[{ 1: 1 }]];}
      if (sql.includes('FROM blocks')) {return [[db.blocks]];}
      if (sql.includes('FROM pools')) {return [[{ total: db.pools }]];}
      if (sql.includes('FROM statistics')) {return [[{ total: 1, oldest: new Date(), newest: new Date() }]];}
      throw new Error('unexpected query ' + sql);
    },
  },
}));
jest.mock('../api/backend-info', () => ({
  __esModule: true,
  default: { getBackendInfo: () => ({ gitCommit: 'test', chainSync: sync.value }) },
}));
jest.mock('../api/capabilities.optional', () => ({ $optionalCapabilityReports: async () => ({}) }));
jest.mock('../api/bitcoin/address-index', () => ({
  addressBackendKind: () => 'electrum',
  $probeAddressIndex: async () => ({
    configured: true, reachable: true, summaryAnswered: true, utxoAnswered: true, state: 'ready',
    degradedReason: null, backendKind: 'electrum', indexedTip: null, chainTip: null, lagBlocks: null,
    maxBehindTip: 2, sourceRelease: null,
  }),
}));

import config from '../config';
import capabilities from '../api/capabilities';

function freshCore(blocks: number, chain = 'main'): Record<string, unknown> {
  return { blocks, headers: blocks, initialBlockDownload: false, verificationProgress: 1, checkedAt: new Date().toISOString(), chain };
}

async function mining(): Promise<Record<string, unknown>> {
  // Each case asks a fresh question; the ten second cache is exercised on its own below.
  (capabilities as unknown as { cached: unknown }).cached = null;
  return (await capabilities.$report()).features.mining as unknown as Record<string, unknown>;
}

describe('mining capability report', () => {
  const saved = { indexing: config.MEMPOOL.INDEXING_BLOCKS_AMOUNT, enabled: config.MEMPOOL.ENABLED, database: config.DATABASE.ENABLED, network: config.MEMPOOL.NETWORK };

  beforeAll(() => {
    config.MEMPOOL.INDEXING_BLOCKS_AMOUNT = 11_000;
    config.MEMPOOL.ENABLED = true;
    config.DATABASE.ENABLED = true;
    config.MEMPOOL.NETWORK = 'mainnet';
    capabilities.markRoutesRegistered('mining');
  });
  afterAll(() => {
    config.MEMPOOL.INDEXING_BLOCKS_AMOUNT = saved.indexing;
    config.MEMPOOL.ENABLED = saved.enabled;
    config.DATABASE.ENABLED = saved.database;
    config.MEMPOOL.NETWORK = saved.network;
  });
  beforeEach(() => {
    db.up = true;
    db.blocks = { total: 11_000, lowest: 957_300, highest: 968_299, newest: new Date('2026-09-23T17:55:00.000Z') };
    db.pools = 180;
    sync.value = freshCore(968_299);
  });

  it('publishes the indexed tip, Core tip and lag with a ready verdict when current', async () => {
    expect(await mining()).toMatchObject({
      state: 'ready', indexedTip: 968_299, bitcoinCoreTip: 968_299, lagBlocks: 0,
      maxLagBlocks: config.MEMPOOL.MINING_MAX_BEHIND_TIP, degradedReason: null, rowCount: 11_000,
      coverage: { from: '957300', to: '968299' },
    });
  });

  it('reports the lagged production state as degraded with its numbers', async () => {
    db.blocks = { ...db.blocks, highest: 968_172 };
    expect(await mining()).toMatchObject({ state: 'degraded', indexedTip: 968_172, bitcoinCoreTip: 968_299, lagBlocks: 127 });
  });

  it('reports unknown, not ready, when Core has never been read', async () => {
    sync.value = null;
    expect(await mining()).toMatchObject({ state: 'unknown', bitcoinCoreTip: null, lagBlocks: null });
  });

  it('reports unknown when the Core reading has expired', async () => {
    sync.value = { ...freshCore(968_299), checkedAt: new Date(Date.now() - 10 * 60_000).toISOString() };
    expect((await mining()).state).toBe('unknown');
  });

  it('reports unknown when Core is on another network than the one served', async () => {
    sync.value = freshCore(968_299, 'signet');
    expect((await mining()).state).toBe('unknown');
  });

  it('reports the database loss as unavailable', async () => {
    db.up = false;
    expect(await mining()).toMatchObject({ state: 'unavailable', degradedReason: 'The mining index database is unavailable.' });
  });

  it('reports empty tables and missing pool metadata as degraded', async () => {
    db.blocks = { total: 0, lowest: null, highest: null, newest: null };
    expect((await mining()).state).toBe('degraded');
    db.blocks = { total: 11_000, lowest: 957_300, highest: 968_299, newest: new Date() };
    db.pools = 0;
    expect(await mining()).toMatchObject({ state: 'degraded', degradedReason: 'Mining pool metadata has not been imported yet.' });
  });

  it('recovers to ready once the collector catches up', async () => {
    db.blocks = { ...db.blocks, highest: 968_000 };
    expect((await mining()).state).toBe('degraded');
    db.blocks = { ...db.blocks, highest: 968_299 };
    expect((await mining()).state).toBe('ready');
  });

  it('never serves a cached ready answer past its ten second life', async () => {
    const now = jest.spyOn(Date, 'now');
    try {
      const start = Date.parse('2026-09-23T18:00:00.000Z');
      now.mockReturnValue(start);
      sync.value = { ...freshCore(968_299), checkedAt: new Date(start).toISOString() };
      (capabilities as unknown as { cached: unknown }).cached = null;
      expect((await capabilities.$report()).features.mining.state).toBe('ready');
      db.up = false;
      now.mockReturnValue(start + 5_000);
      expect((await capabilities.$report()).features.mining.state).toBe('ready');
      now.mockReturnValue(start + 10_001);
      expect((await capabilities.$report()).features.mining.state).toBe('unavailable');
    } finally {
      now.mockRestore();
    }
  });
});
