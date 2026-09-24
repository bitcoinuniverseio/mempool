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
    $getRawTransaction: async (txid: string) => {
      inFlight.calls += 1;
      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight.now -= 1;
      if (txid.endsWith('f')) {throw new Error('404');}
      return { txid, status: { confirmed: false } };
    },
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
