/**
 * Restoring the RBF cache checks every unexpired cached transaction against
 * the node before the HTTP server listens. Read one at a time, 8,044 of them
 * held the explorer API down for about half an hour per restart on
 * 2026-09-23. These pin the replacement: every transaction is still read,
 * never more than RBF_CHECK_CONCURRENCY at once, and a failed read does not
 * stop the rest.
 */
import http from 'http';
const inFlight = { now: 0, max: 0, calls: 0 };

jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: {
    $getRawTransaction: jest.fn(async (txid: string) => {
      inFlight.calls += 1;
      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight.now -= 1;
      if (txid.endsWith('f')) {throw Object.assign(new Error('No such mempool or blockchain transaction'), { code: -5, rpcMethod: 'getrawtransaction' });}
      return { txid, status: { confirmed: false } };
    }),
  },
}));

import config from '../config';

// testSetup replaces rbf-cache with an empty module; this suite needs the real one.
// Its constructor starts a ten minute cleanup interval, which would keep Jest
// from exiting, so only setInterval is faked; the reads still use real timeouts.
jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'nextTick', 'queueMicrotask', 'Date'] });
const { default: rbfCache, RBF_CHECK_CONCURRENCY } = jest.requireActual('../api/rbf-cache');

describe('RBF cache restore against an electrum or Core backend', () => {
  const backend = config.MEMPOOL.BACKEND;
  afterAll(() => { config.MEMPOOL.BACKEND = backend; jest.clearAllTimers(); jest.useRealTimers(); });

  it('reads every cached transaction with at most the bounded number in flight', async () => {
    config.MEMPOOL.BACKEND = 'electrum';
    const count = 120;
    const txs = Array.from({ length: count }, (_, i) => {
      const txid = i.toString(16).padStart(63, '0') + (i % 10 === 0 ? 'f' : '0');
      return { value: { txid, vin: [], vout: [], fee: 0, weight: 400, vsize: 100, adjustedVsize: 100, sigops: 0, feePerVsize: 0, effectiveFeePerVsize: 0 } };
    });
    await rbfCache.load({ txs, trees: [], expiring: [], mempool: {}, spendMap: new Map() });
    expect(inFlight.calls).toBe(count);
    expect(inFlight.max).toBeGreaterThan(1);
    expect(inFlight.max).toBeLessThanOrEqual(RBF_CHECK_CONCURRENCY);
    expect(inFlight.now).toBe(0);
  });
});


describe('RBF restore response and disabled Redis ownership', () => {
  const redis = config.REDIS.ENABLED;
  const backend = config.MEMPOOL.BACKEND;
  const tx = (n: number): any => ({ txid: n.toString(16).padStart(64, '0'), vin: [{ txid: '0'.repeat(64), vout: 0, sequence: 1 }], vout: [{ value: 1 }], fee: 100, weight: 400, vsize: 100, effectiveFeePerVsize: 1, firstSeen: 100 });
  beforeEach(() => {
    for (const key of ['replacedBy', 'replaces', 'rbfTrees', 'dirtyTrees', 'treeMap', 'txs', 'expiring']) { (rbfCache as any)[key].clear(); }
    (rbfCache as any).cacheQueue = [];
    config.REDIS.ENABLED = false; config.MEMPOOL.BACKEND = 'electrum';
  });
  afterEach(() => { config.REDIS.ENABLED = redis; config.MEMPOOL.BACKEND = backend; });
  it('does not retain unused Redis events while preserving actual replacement/tree/expiration state', async () => {
    for (let n = 0; n < 100; n++) { rbfCache.add([tx(n * 2)], tx(n * 2 + 1)); rbfCache.mined(tx(n * 2 + 1).txid); }
    expect((rbfCache as any).cacheQueue).toHaveLength(0);
    expect(rbfCache.dump().txs).toHaveLength(200); expect(rbfCache.dump().trees).toHaveLength(100);
    expect(rbfCache.getReplacedBy(tx(0).txid)).toBe(tx(1).txid);
    const before = JSON.stringify(rbfCache.dump()); await rbfCache.updateCache();
    expect(JSON.stringify(rbfCache.dump())).toBe(before);
  });
  it('keeps queued Redis events when enabled and discards only unconsumable events after disabling', async () => {
    config.REDIS.ENABLED = true; rbfCache.add([tx(0)], tx(1));
    expect((rbfCache as any).cacheQueue.length).toBeGreaterThan(0);
    const before = JSON.stringify(rbfCache.dump()); config.REDIS.ENABLED = false; await rbfCache.updateCache();
    expect((rbfCache as any).cacheQueue).toHaveLength(0); expect(JSON.stringify(rbfCache.dump())).toBe(before);
  });
  it('processes a completed RPC response before an unrelated outstanding response settles', async () => {
    const api = require('../api/bitcoin/bitcoin-api-factory').default;
    const original = api.$getRawTransaction.getMockImplementation();
    let release!: (value: any) => void;
    const late = new Promise(resolve => { release = resolve; });
    api.$getRawTransaction.mockImplementation((id: string) => id === tx(0).txid ? Promise.resolve({ txid: id, status: { confirmed: true, block_height: 1, block_hash: 'a'.repeat(64), block_time: 100 } }) : late);
    const trees = [0, 1].map(n => ({ root: tx(n).txid, [tx(n).txid]: { tx: tx(n).txid, time: 100, fullRbf: false, replaces: [] } }));
    const restoring = rbfCache.load({ txs: [0, 1].map(n => ({ value: tx(n) })), trees, expiring: [], mempool: {}, spendMap: new Map() });
    try {
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(rbfCache.getRbfTree(tx(0).txid)?.mined).toBe(true);
      expect(rbfCache.getRbfTree(tx(1).txid)?.mined).toBe(false);
    } finally { release({ txid: tx(1).txid, status: { confirmed: false } }); await restoring; api.$getRawTransaction.mockImplementation(original); }
  });
  it.each(['ETIMEDOUT', 'ERPC_HTTP', 'ERPC_RESPONSE', -32603])('refuses unknown native failure %s without scheduling missing expiry', async code => {
    const api = require('../api/bitcoin/bitcoin-api-factory').default;
    const original = api.$getRawTransaction.getMockImplementation();
    api.$getRawTransaction.mockRejectedValue(Object.assign(new Error('controlled native failure'), { code }));
    try {
      expect(await rbfCache.load({ txs: [{ value: tx(0) }], trees: [], expiring: [], mempool: {}, spendMap: new Map() })).toBe(false);
      expect((rbfCache as any).expiring.has(tx(0).txid)).toBe(false);
    } finally { api.$getRawTransaction.mockImplementation(original); }
  });
  it.each([null, { txid: '9'.repeat(64), status: { confirmed: false } }, { txid: '0'.repeat(64), confirmations: 6 }])('refuses malformed or mismatched native response %#', async response => {
    const api = require('../api/bitcoin/bitcoin-api-factory').default;
    const original = api.$getRawTransaction.getMockImplementation(); api.$getRawTransaction.mockResolvedValue(response);
    try {
      expect(await rbfCache.load({ txs: [{ value: tx(0) }], trees: [], expiring: [], mempool: {}, spendMap: new Map() })).toBe(false);
      expect((rbfCache as any).expiring.has(tx(0).txid)).toBe(false);
    } finally { api.$getRawTransaction.mockImplementation(original); }
  });
  it('normalizes an actual BitcoinApi Core transaction and validates its header before marking its tree mined', async () => {
    const api = require('../api/bitcoin/bitcoin-api-factory').default;
    const original = api.$getRawTransaction.getMockImplementation();
    const mempool = require('../api/mempool'); const previous = mempool.getMempool;
    mempool.getMempool = () => ({});
    const BitcoinApi = jest.requireActual('../api/bitcoin/bitcoin-api').default;
    const blockHash = 'a'.repeat(64);
    const client = { getRawTransaction: jest.fn(async () => ({ txid: tx(0).txid, version: 2, locktime: 0,
      size: 100, weight: 400, vin: [], vout: [], confirmations: 3, blockhash: blockHash })),
    getBlockHeader: jest.fn(async () => ({ hash: blockHash, height: 100, time: 1000, confirmations: 3 })) };
    const native = new BitcoinApi(client); api.$getRawTransaction.mockImplementation(native.$getRawTransaction.bind(native));
    try {
      const trees = [{ root: tx(0).txid, [tx(0).txid]: { tx: tx(0).txid, time: 100, fullRbf: false, replaces: [] } }];
      expect(await rbfCache.load({ txs: [{ value: tx(0) }], trees, expiring: [], mempool: {}, spendMap: new Map() })).toBe(true);
      expect(api.$getRawTransaction).toHaveBeenLastCalledWith(tx(0).txid, false, false);
      expect(client.getBlockHeader).toHaveBeenCalledWith(blockHash, true);
      expect(rbfCache.getRbfTree(tx(0).txid)?.mined).toBe(true);
    } finally { api.$getRawTransaction.mockImplementation(original); mempool.getMempool = previous; }
  });
  it('settles every bounded worker before reporting an earlier source failure', async () => {
    const api = require('../api/bitcoin/bitcoin-api-factory').default;
    const original = api.$getRawTransaction.getMockImplementation();
    let release!: (value: any) => void;
    const late = new Promise(resolve => { release = resolve; });
    api.$getRawTransaction.mockImplementation((id: string) => id === tx(0).txid
      ? Promise.reject(Object.assign(new Error('controlled timeout'), { code: 'ETIMEDOUT' })) : late);
    let settled = false;
    const restoring = rbfCache.load({ txs: [0, 1].map(n => ({ value: tx(n) })), trees: [], expiring: [], mempool: {}, spendMap: new Map() })
      .then(result => { settled = true; return result; });
    try {
      await new Promise(resolve => setTimeout(resolve, 10)); expect(settled).toBe(false);
      release({ txid: tx(1).txid, status: { confirmed: false } });
      expect(await restoring).toBe(false);
      expect((rbfCache as any).expiring.size).toBe(0);
    } finally { release({ txid: tx(1).txid, status: { confirmed: false } }); await restoring; api.$getRawTransaction.mockImplementation(original); }
  });
  it.each([200, 500, 404, 503])('distinguishes actual Core domain absence from HTTP endpoint failure at status %s', async status => {
    const server = http.createServer((request, response) => {
      let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => {
        const call = JSON.parse(body); response.statusCode = status;
        response.end(JSON.stringify({ id: call.id, result: null, error: { code: -5, message: 'private request data is never forwarded' } }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { JsonRPC } = jest.requireActual('../rpc-api/jsonrpc');
    const rpc = new JsonRPC({ host: '127.0.0.1', port: (server.address() as any).port, timeout: 1000 });
    const api = require('../api/bitcoin/bitcoin-api-factory').default; const original = api.$getRawTransaction.getMockImplementation();
    api.$getRawTransaction.mockImplementation((id: string) => rpc.call('getrawtransaction', [id, true]));
    try {
      const genuineAbsent = status === 200 || status === 500;
      expect(await rbfCache.load({ txs: [{ value: tx(0) }], trees: [], expiring: [], mempool: {}, spendMap: new Map() })).toBe(genuineAbsent);
      expect((rbfCache as any).expiring.has(tx(0).txid)).toBe(genuineAbsent);
    } finally {
      api.$getRawTransaction.mockImplementation(original); rpc.agent.destroy(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it('refuses genuine getblockheader -5 after a successful normalized getrawtransaction without treating the TX as absent', async () => {
    const blockHash = 'a'.repeat(64);
    const server = http.createServer((request, response) => {
      let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => {
        const call = JSON.parse(body);
        if (call.method === 'getrawtransaction') {
          response.end(JSON.stringify({ id: call.id, error: null, result: { txid: tx(0).txid, version: 2, locktime: 0,
            size: 100, weight: 400, vin: [], vout: [], confirmations: 3, blockhash: blockHash } }));
        } else {
          expect(call.method).toBe('getblockheader'); response.statusCode = 500;
          response.end(JSON.stringify({ id: call.id, result: null, error: { code: -5, message: 'Block not found' } }));
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { Client } = jest.requireActual('../rpc-api/index');
    const client = new Client({ host: '127.0.0.1', port: (server.address() as any).port, timeout: 1000 });
    const mempool = require('../api/mempool'); const previous = mempool.getMempool; mempool.getMempool = () => ({});
    const BitcoinApi = jest.requireActual('../api/bitcoin/bitcoin-api').default; const native = new BitcoinApi(client);
    const api = require('../api/bitcoin/bitcoin-api-factory').default; const original = api.$getRawTransaction.getMockImplementation();
    api.$getRawTransaction.mockImplementation(native.$getRawTransaction.bind(native));
    try {
      expect(await rbfCache.load({ txs: [{ value: tx(0) }], trees: [], expiring: [], mempool: {}, spendMap: new Map() })).toBe(false);
      expect((rbfCache as any).expiring.has(tx(0).txid)).toBe(false);
    } finally {
      api.$getRawTransaction.mockImplementation(original); mempool.getMempool = previous;
      client.rpc.agent.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
