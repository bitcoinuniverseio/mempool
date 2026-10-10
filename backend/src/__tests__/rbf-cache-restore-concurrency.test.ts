/**
 * Restoring the RBF cache checks every unexpired cached transaction against
 * the node before the HTTP server listens. Read one at a time, 8,044 of them
 * held the explorer API down for about half an hour per restart on
 * 2026-09-23. These pin the replacement: every transaction is still read,
 * never more than RBF_CHECK_CONCURRENCY at once, and a failed read does not
 * stop the rest.
 */
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
      if (txid.endsWith('f')) {throw new Error('404');}
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
  beforeAll(() => { const state = require('../api/rbf-snapshot').rbfRestoreState; state.beginRestore(); state.completeRestore('no-file'); });
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
    api.$getRawTransaction.mockImplementation((id: string) => id === tx(0).txid ? Promise.resolve({ txid: id, status: { confirmed: true } }) : late);
    const trees = [0, 1].map(n => ({ root: tx(n).txid, [tx(n).txid]: { tx: tx(n).txid, time: 100, fullRbf: false, replaces: [] } }));
    const restoring = rbfCache.load({ txs: [0, 1].map(n => ({ value: tx(n) })), trees, expiring: [], mempool: {}, spendMap: new Map() });
    try {
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(rbfCache.getRbfTree(tx(0).txid)?.mined).toBe(true);
      expect(rbfCache.getRbfTree(tx(1).txid)?.mined).toBe(false);
    } finally { release({ txid: tx(1).txid, status: { confirmed: false } }); await restoring; api.$getRawTransaction.mockImplementation(original); }
  });
  it('does not accumulate quarantined historical notifications while preserving observed graph/body state', () => {
    const state=require('../api/rbf-snapshot').rbfRestoreState; state.fail('snapshot-oversize');
    for(let n=0;n<100;n++){ rbfCache.add([tx(n*2)],tx(n*2+1));rbfCache.mined(tx(n*2+1).txid); }
    expect((rbfCache as any).dirtyTrees.size).toBe(0);expect((rbfCache as any).cacheQueue).toHaveLength(0);
    expect(rbfCache.dump().txs).toHaveLength(200);expect(rbfCache.dump().trees).toHaveLength(100);
    expect(rbfCache.getReplacedBy(tx(0).txid)).toBe(tx(1).txid);
  });

});
