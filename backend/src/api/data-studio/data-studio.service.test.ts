import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataStudioService, exportBytes } from './data-studio.service';
import { DataSource, DataSnapshot, snapshotDigest, OwnedDataSource } from './data-studio-source';
const fixture = (network = 'regtest'): DataSnapshot => {
  const body: any = {
    schema: 'owned-data-v1',
    network,
    genesis: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
    observedAt: new Date().toISOString(),
    tipHash: 'a'.repeat(64),
    tipHeight: 3,
    mempoolSequence: '4',
    datasets: {
      'bitcoin.blocks': [1, 2, 3].map((height) => ({
        height,
        hash: String(height).repeat(64),
        previous_hash: '0'.repeat(64),
        merkle_root: '0'.repeat(64),
        time: height * 10,
        version: 2,
        bits: 1,
        nonce: height,
        header_hex: '00'.repeat(80),
      })),
      'bitcoin.mempool': [{ txid: 'b'.repeat(64) }],
    },
    unavailable: {},
    scope: 'Bounded test source',
  };
  return { ...body, id: snapshotDigest(body) };
};
const make = () => {
  const path = join(mkdtempSync(join(tmpdir(), 'data-studio-')), 'state.gz'),
    snapshot = fixture(),
    source: DataSource = { network: 'regtest', read: jest.fn(async () => snapshot) },
    service = new DataStudioService(source, path);
  return { path, snapshot, source, service };
};
describe('owned immutable dataset authority', () => {
  it('uses exact encoded export byte/row counts and immutable snapshot identity', async () => {
    const f = make();
    try {
      const c = await f.service.$getCatalog();
      expect(c.datasets[0].rowCount).toBe(3);
      for (const format of ['json', 'csv', 'ndjson']) {
        const e = await f.service.export(c.snapshotId, 'bitcoin.blocks', format);
        expect(e.bytes.length).toBe(c.datasets[0].exports[format].bytes);
        expect(e.sha256).toBe(c.datasets[0].exports[format].sha256);
      }
      expect(c.snapshotId).toBe(snapshotDigest(f.snapshot));
      expect(c.datasets[0].supportedFormats).not.toContain('parquet');
    } finally {
      await f.service.close();
    }
  });
  it('applies typed filters, stable ordering/projection and exact filtered pagination', async () => {
    const f = make();
    try {
      const c = await f.service.$getCatalog();
      const q = await f.service.$executeQuery({
        datasetId: 'bitcoin.blocks',
        snapshotId: c.snapshotId,
        fields: ['height', 'hash'],
        filters: [{ field: 'height', operator: 'gte', value: 2 }],
        orderBy: 'height',
        orderDirection: 'desc',
        limit: 1,
      });
      expect(q.rows).toEqual([[3, '3'.repeat(64)]]);
      expect(q.totalAvailable).toBe(2);
      expect(q.nextOffset).toBe(1);
      const next = await f.service.$executeQuery({
        datasetId: 'bitcoin.blocks',
        snapshotId: c.snapshotId,
        fields: ['height'],
        orderBy: 'height',
        orderDirection: 'desc',
        offset: 1,
        limit: 1,
      });
      expect(next.rows).toEqual([[2]]);
    } finally {
      await f.service.close();
    }
  });
  it('rejects malformed types, unknown fields/properties and unbounded pagination before source access', async () => {
    const f = make();
    try {
      for (const q of [
        { datasetId: '__proto__' },
        { datasetId: 'bitcoin.blocks', sql: 'DROP TABLE x' },
        { datasetId: 'bitcoin.blocks', limit: NaN },
        { datasetId: 'bitcoin.blocks', limit: 1001 },
        { datasetId: 'bitcoin.blocks', fields: ['height', 'height'] },
        { datasetId: 'bitcoin.blocks', filters: [{ field: 'height', operator: 'eq', value: '2' }] },
        { datasetId: 'bitcoin.blocks', orderBy: 'constructor' },
      ])
        await expect(f.service.$executeQuery(q as any)).rejects.toMatchObject({ status: 400 });
      expect(f.source.read).not.toHaveBeenCalled();
    } finally {
      await f.service.close();
    }
  });
  it('restores exact historical rows across restart and emits an explicit observation gap', async () => {
    const f = make();
    const c = await f.service.$getCatalog();
    const cursor = f.service.eventsAfter()[0].id;
    await f.service.close();
    const restored = new DataStudioService(f.source, f.path);
    try {
      expect(
        (await restored.$executeQuery({ datasetId: 'bitcoin.blocks', snapshotId: c.snapshotId })).rows.length
      ).toBe(3);
      await restored.refresh();
      expect(restored.eventsAfter(cursor).map((e) => e.kind)).toEqual(['observation_gap', 'snapshot']);
    } finally {
      await restored.close();
    }
  });
  it('rejects corrupt and wrong-network persisted evidence', async () => {
    const f = make();
    await f.service.$getCatalog();
    await f.service.close();
    const wrong = new DataStudioService({ network: 'signet', read: async () => fixture('signet') }, f.path);
    await expect(wrong.refresh()).rejects.toMatchObject({ code: 'data-storage-invalid' });
    await wrong.close();
    const bytes = readFileSync(f.path);
    bytes[20] ^= 1;
    writeFileSync(f.path, bytes);
    const broken = new DataStudioService(f.source, f.path);
    await expect(broken.refresh()).rejects.toMatchObject({ code: 'data-storage-invalid' });
    await broken.close();
  });
  it('does not answer source failures as empty datasets', async () => {
    const f = make();
    f.source.read = async () => {
      throw Error('offline');
    };
    try {
      await expect(f.service.$getCatalog()).rejects.toThrow('offline');
    } finally {
      await f.service.close();
    }
  });
  it('refuses expired/foreign stream cursors and unknown snapshots', async () => {
    const f = make();
    try {
      await f.service.refresh();
      expect(() => f.service.eventsAfter('00000000-0000-4000-8000-000000000001:1')).toThrow();
      await expect(f.service.snapshot('0'.repeat(64))).rejects.toMatchObject({ status: 410 });
    } finally {
      await f.service.close();
    }
  });
  it('validates actual serialized owned genesis headers and binds selected network', async () => {
    const header =
      '01000000' +
      '00'.repeat(32) +
      '3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a' +
      'dae5494dffff7f2002000000';
    const genesis = fixture().genesis;
    const client = {
      getBlockHash: async () => genesis,
      getBlockchainInfo: async () => ({
        chain: 'regtest',
        blocks: 0,
        bestblockhash: genesis,
        initialblockdownload: false,
      }),
      getBlockHeader: async () => header,
      getMempoolInfo: async () => ({ size: 0 }),
      getRawMemPool: async () => ({ txids: [], mempool_sequence: 0 }),
      getBestBlockHash: async () => genesis,
    };
    const s = await new OwnedDataSource(client, 'regtest').read();
    expect(s.datasets['bitcoin.blocks'][0].hash).toBe(genesis);
    expect(s.datasets['bitcoin.mempool']).toEqual([]);
    await expect(new OwnedDataSource(client, 'signet').read()).rejects.toMatchObject({ code: 'data-network-mismatch' });
  });
});

describe('owned source checkpoint brackets', () => {
  const genesis = fixture().genesis,
    header =
      '01000000' +
      '00'.repeat(32) +
      '3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a' +
      'dae5494dffff7f2002000000';
  const valid = { chain: 'regtest', blocks: 0, bestblockhash: genesis, initialblockdownload: false };
  const client = (first: any, last: any = first) => ({
    getBlockHash: async () => genesis,
    getBlockchainInfo: jest.fn().mockResolvedValueOnce(first).mockResolvedValue(last),
    getBlockHeader: jest.fn(async () => header),
    getMempoolInfo: async () => ({ size: 0 }),
    getRawMemPool: async () => ({ txids: [], mempool_sequence: 0 }),
  });
  it.each([
    undefined,
    null,
    { ...valid, initialblockdownload: undefined },
    { ...valid, initialblockdownload: 'false' },
    { ...valid, initialblockdownload: true },
    { ...valid, chain: 'main' },
  ])('rejects malformed or wrong initial chain state %#', async (info) => {
    const rpc = client(info);
    await expect(new OwnedDataSource(rpc, 'regtest').read()).rejects.toMatchObject({
      code: 'data-chain-state-invalid',
    });
    expect(rpc.getBlockHeader).not.toHaveBeenCalled();
  });
  it.each([
    { ...valid, blocks: 1 },
    { ...valid, blocks: '0' },
    { ...valid, chain: 'main' },
    { ...valid, initialblockdownload: true },
    { ...valid, initialblockdownload: undefined },
    { ...valid, bestblockhash: 'a'.repeat(64) },
  ])('rejects final bracket mismatch even when the tip hash is unchanged %#', async (final) => {
    await expect(new OwnedDataSource(client(valid, final), 'regtest').read()).rejects.toMatchObject({
      code: 'data-tip-changed',
    });
  });
});
