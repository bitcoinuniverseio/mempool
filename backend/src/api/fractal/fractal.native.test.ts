import { FractalService } from './fractal.service';
import { FractalNativeReader, FRACTAL_TESTNET_BLOCK_ONE, FRACTAL_TESTNET_GENESIS, atomic, createFractalRpc, FractalSourceProfile, parseFractalRpcJson } from './fractal.native';
import { Cat20Projection, catSchemaDigest, CAT_SCHEMA_SQL } from './fractal.cat';

const tip = 'a'.repeat(64);
const profile: FractalSourceProfile = { network: 'fractal-testnet', release: '0.4.0', sourceRevision: '8c22167f04250c7dd03afe46af4158bd08001183', configurationSha256: 'b'.repeat(64), binarySha256: 'c'.repeat(64) };
function rpcFixture(overrides: Record<string, unknown> = {}): jest.Mock<Promise<unknown>, [string, unknown[]]> {
  return jest.fn(async (method: string, params: unknown[]) => {
    if (Object.prototype.hasOwnProperty.call(overrides, method)) { const override = overrides[method]; return typeof override === 'function' ? override(params) : override; }
    switch (method) {
      case 'getblockchaininfo': return { chain: 'test', initialblockdownload: false, blocks: 100, headers: 100, bestblockhash: tip };
      case 'getnetworkinfo': return { version: 400, subversion: '/Satoshi:0.4.0/' };
      case 'getblockhash': return params[0] === 0 ? FRACTAL_TESTNET_GENESIS : params[0] === 1 ? FRACTAL_TESTNET_BLOCK_ONE : tip;
      case 'getblockheader': return { hash: tip, height: 100, time: 1000 };
      default: throw new Error('Unconfigured fixture method ' + method);
    }
  });
}
describe('Fractal native source boundaries (component qualification)', () => {
  test('shared Bitcoin genesis and bc syntax cannot replace the pinned testnet block one', async () => {
    const rpc = rpcFixture({ getblockhash: (args: unknown[]) => args[0] === 0 ? FRACTAL_TESTNET_GENESIS : 'd'.repeat(64) });
    await expect(new FractalService(new FractalNativeReader(profile, rpc)).$getTip()).rejects.toMatchObject({ code: 'wrong-fractal-source' });
    expect(rpc.mock.calls.some(call => call[0] === 'getblockheader')).toBe(false);
  });
  test('tip reports IBD honestly; CAT complete directory refuses it without DB IO', async () => {
    const native = new FractalNativeReader(profile, rpcFixture({ getblockchaininfo: { chain: 'test', initialblockdownload: true, blocks: 100, headers: 101, bestblockhash: tip } }));
    expect((await new FractalService(native).$getTip()).observation.ready).toBe(false);
    const connect = jest.fn();
    const cat = new Cat20Projection(native, { connect }, { sourceRevision: '8d5aeee7484bacc33d0014b44503c0b59d39aaff', schemaSha256: 'e'.repeat(64), configurationSha256: 'f'.repeat(64) }, Buffer.alloc(32, 1));
    await expect(cat.tokens()).rejects.toMatchObject({ code: 'cat20-node-not-ready' });
    expect(connect).not.toHaveBeenCalled();
  });
  test('malformed input is rejected before any native IO', async () => {
    const rpc = rpcFixture(); const service = new FractalService(new FractalNativeReader(profile, rpc));
    await expect(service.$getBlock('01')).rejects.toMatchObject({ status: 400 });
    await expect(service.$getTransaction('F'.repeat(64))).rejects.toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });
  test('inherited release string is insufficient without test chain', async () => {
    await expect(new FractalService(new FractalNativeReader(profile, rpcFixture({ getblockchaininfo: { chain: 'main' } }))).$getTip()).rejects.toMatchObject({ code: 'wrong-fractal-source' });
  });
  test('canonical hash changing during the observation rejects the whole result', async () => {
    let reads = 0;
    const rpc = rpcFixture({ getblockhash: (args: unknown[]) => args[0] === 0 ? FRACTAL_TESTNET_GENESIS : args[0] === 1 ? FRACTAL_TESTNET_BLOCK_ONE : ++reads > 1 ? 'd'.repeat(64) : tip });
    await expect(new FractalService(new FractalNativeReader(profile, rpc)).$getTip()).rejects.toMatchObject({ status: 409 });
  });
  test('total deadline rejects uncooperative RPC and prevents later IO', async () => {
    let resolve!: (value: unknown) => void;
    const rpc = jest.fn(() => new Promise(resolvePromise => { resolve = resolvePromise; }));
    const attempt = new FractalService(new FractalNativeReader(profile, rpc, 20)).$getTip();
    await expect(attempt).rejects.toMatchObject({ status: 504 });
    resolve({ chain: 'test' });
    await new Promise(done => setImmediate(done));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  test('one satoshi and large exact native amounts stay integer strings', () => {
    expect(atomic(0.00000001)).toBe('1');
    expect(atomic('20999999.99999999')).toBe('2099999999999999');
    expect(() => atomic('1.000000001')).toThrow();
    expect(() => atomic(0.000000001)).toThrow();
    expect(parseFractalRpcJson('{"value":210000000.99999999,"n":1,"string":"escaped \\"value\\": 3"}')).toMatchObject({ value: '210000000.99999999', n: 1 });
  });
  test('aggregate mempool observation does not invent fee distribution or pending CAT', async () => {
    const service = new FractalService(new FractalNativeReader(profile, rpcFixture({ getmempoolinfo: { loaded: true, size: 3, bytes: 500 } })));
    const result = await service.$getMempool();
    expect(result).toMatchObject({ count: 3, totalBytes: 500, pendingCat20TxCount: null, totalWeight: null, medianFeeRate: null });
  });
  test('transport refuses foreign origins and embedded credentials', () => {
    expect(() => createFractalRpc('http://example.com', async () => 'user:password')).toThrow();
    expect(() => createFractalRpc('http://user:password@127.0.0.1:47732', async () => 'user:password')).toThrow();
  });
  test('native coinbase has no fabricated outpoint, fee or CAT operation', async () => {
    const txid = 'f'.repeat(64);
    const rpc = rpcFixture({ getindexinfo: { txindex: { synced: true, best_block_height: 100 } },
      getrawtransaction: { txid, hash: txid, version: 2, size: 100, weight: 400, locktime: 0,
        vin: [{ coinbase: '0101', sequence: 4294967295 }], vout: [{ value: 0.00000001, n: 0, scriptPubKey: { asm: '', hex: '', type: 'nulldata' } }] } });
    const tx = await new FractalService(new FractalNativeReader(profile, rpc)).$getTransaction(txid);
    expect(tx).toMatchObject({ feeAtomic: null, cat20State: 'not-joined', vin: [{ coinbase: '0101' }], vout: [{ valueAtomic: '1' }] });
    expect(tx?.vin[0]).not.toHaveProperty('txid');
  });
  test('lagging txindex cannot turn unobserved transaction into not-found', async () => {
    const rpc = rpcFixture({ getindexinfo: { txindex: { synced: true, best_block_height: 99 } }, getrawtransaction: null });
    await expect(new FractalService(new FractalNativeReader(profile, rpc)).$getTransaction('f'.repeat(64))).rejects.toMatchObject({ code: 'unavailable-fractal-txindex' });
    expect(rpc.mock.calls.some(call => call[0] === 'getrawtransaction')).toBe(false);
  });
  test('read transport refuses write RPC and deadline-late credentials before fetch', async () => {
    const fetcher = jest.fn();
    const transport = createFractalRpc('http://127.0.0.1:47732', async () => 'reader:secret', fetcher);
    await expect(transport('sendrawtransaction', ['00'], new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-fractal-rpc-method' });
    const controller = new AbortController(); controller.abort();
    await expect(transport('getblockchaininfo', [], controller.signal)).rejects.toMatchObject({ status: 504 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('CAT repeatable snapshot boundaries (component qualification)', () => {
  const schema = { columns: ['component-schema'], constraints: [], indexes: [] };
  function setup(options: { missingSpend?: boolean; lag?: boolean; schemaChanged?: boolean } = {}): { cat: Cat20Projection; queries: { text: string; values?: unknown[] }[]; release: jest.Mock } {
    const queries: { text: string; values?: unknown[] }[] = [];
    const release = jest.fn();
    const query = jest.fn(async (request: { text: string; values?: unknown[] }) => {
      queries.push(request);
      if (request.text === CAT_SCHEMA_SQL) { return { rows: [{ schema: options.schemaChanged ? { ...schema, columns: ['changed'] } : schema }] }; }
      if (request.text.includes('FROM block ORDER')) { return { rows: [{ height: options.lag ? 99 : 100, hash: tip }] }; }
      if (request.text.startsWith('SELECT hash FROM block')) { return { rows: [{ hash: tip }] }; }
      if (request.text.startsWith('SELECT 1 FROM ')) { return { rows: options.missingSpend && request.text.includes('s.txid IS NULL') ? [{ '?column?': 1 }] : [] }; }
      if (request.text.startsWith('SELECT * FROM token_info')) { return { rows: [{ token_id: tip + '_0', name: 'native', symbol: 'N', decimals: 0, minter_pubkey: 'd'.repeat(64), token_pubkey: 'e'.repeat(64), first_mint_height: 5, reveal_txid: tip, reveal_height: 2 }] }; }
      if (request.text.includes('AS supply')) { return { rows: [{ pubkey: 'e'.repeat(64), supply: '9007199254740993', holders: '1' }] }; }
      if (request.text.includes('COUNT(*)::text AS total')) { return { rows: [{ total: '1' }] }; }
      return { rows: [] };
    });
    const native = new FractalNativeReader(profile, rpcFixture());
    const cat = new Cat20Projection(native, { connect: async (): Promise<{ query: typeof query; release: typeof release }> => ({ query, release }) }, { sourceRevision: '8d5aeee7484bacc33d0014b44503c0b59d39aaff', schemaSha256: catSchemaDigest(schema), configurationSha256: 'f'.repeat(64) }, Buffer.alloc(32, 1));
    return { cat, queries, release };
  }
  test('native schema, snapshot and height-fenced exact supply bind each result', async () => {
    const { cat, queries, release } = setup();
    const result = await cat.tokens();
    expect(result.items[0].circulatingSupplyAtomic).toBe('9007199254740993');
    expect(queries[0].text).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(queries.some(q => q.text.includes('o.block_height <= $1') && q.text.includes('s.block_height > $1'))).toBe(true);
    expect(queries.at(-1)?.text).toBe('COMMIT'); expect(release).toHaveBeenCalledTimes(1);
  });
  test.each([['lag', 'cat20-checkpoint-lag'], ['schemaChanged', 'cat20-schema-changed'], ['missingSpend', 'cat20-incomplete-spend']])('%s refuses result and rolls back once', async (key, code) => {
    const { cat, queries, release } = setup({ [key]: true });
    await expect(cat.tokens()).rejects.toMatchObject({ code });
    expect(queries.at(-1)?.text).toBe('ROLLBACK'); expect(release).toHaveBeenCalledTimes(1);
  });
  test('forged cursors and oversized pages fail before opening a DB transaction', async () => {
    const { cat, queries } = setup();
    await expect(cat.tokens({ cursor: 'e30.invalid' })).rejects.toMatchObject({ status: 400 });
    await expect(cat.tokens({ limit: 501 })).rejects.toMatchObject({ status: 400 });
    expect(queries).toHaveLength(0);
  });
});
