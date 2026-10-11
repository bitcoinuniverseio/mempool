import { defaultMock, isolatedBackend, quietLogger } from '../../test-support/isolated-backend-helper';

function fixture(entry: (txid: string) => Promise<unknown>, fetched: string[], secondRead: string[] = [], batched?: (txids: string[]) => Promise<unknown[]>) {
  const reads = new Map<string, number>();
  const config = { MEMPOOL: { BACKEND: 'electrum', CLEAR_PROTECTION_MINUTES: 20 }, ESPLORA: { BATCH_QUERY_BASE_SIZE: 1000 }, REDIS: { ENABLED: false } };
  const mempool = isolatedBackend('api/mempool.ts', {
    '../config': defaultMock(config), '../logger': quietLogger,
    './common': { Common: { stripTransaction: (tx: unknown) => tx } },
    './transaction-utils': defaultMock({ $getMempoolTransactionsExtended: async (txids: string[]) =>
      txids.filter(txid => {
        reads.set(txid, (reads.get(txid) ?? 0) + 1);
        return fetched.includes(txid) || (secondRead.includes(txid) && reads.get(txid) === 2);
      }).map(txid => ({ txid, vsize: 100 })), extendMempoolTransaction: (tx: unknown) => tx }),
    './loading-indicators': defaultMock({ setProgress: () => {} }),
    './bitcoin/bitcoin-api-factory': defaultMock(batched ? { $getMempoolTransactionsBatched: batched } : {}),
    './bitcoin/bitcoin-client': defaultMock({ getMempoolEntry: entry }),
    './rbf-cache': defaultMock({ freezeLiveBody: () => {}, updateCache: async () => {} }),
  }).default;
  const polls: boolean[] = [];
  mempool.setObservedPollCallback((_added: unknown, _deleted: unknown, complete: boolean) => polls.push(complete));
  return { mempool, polls, reads };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const gone = () => Promise.reject(Object.assign(new Error('Transaction not in mempool'), { code: -5 }));

test('a snapshot txid the node no longer holds does not make the poll incomplete', async () => {
  const { mempool, polls } = fixture(gone, ['a', 'b']);
  await mempool.$updateMempool(['a', 'b', 'replaced'], null, [], -1, 2000);
  expect(polls).toEqual([true]);
  expect(mempool.isInSync()).toBe(true);
});

test('a txid the node still holds is read once more in the same poll', async () => {
  const { mempool, polls, reads } = fixture(async () => ({ fees: {} }), ['a', 'b'], ['flaky']);
  await mempool.$updateMempool(['a', 'b', 'flaky'], null, [], -1, 2000);
  expect(polls).toEqual([true]);
  expect(Object.keys(mempool.getMempool()).sort()).toEqual(['a', 'b', 'flaky']);
  expect(reads.get('flaky')).toBe(2);
});

test('a txid that stays unreadable, or that the node cannot answer for, keeps the poll incomplete', async () => {
  for (const entry of [async () => ({ fees: {} }), () => Promise.reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))]) {
    const { mempool, polls, reads } = fixture(entry, ['a', 'b']);
    await mempool.$updateMempool(['a', 'b', 'held'], null, [], -1, 2000);
    expect(polls).toEqual([false]);
    expect(mempool.isInSync()).toBe(false);
    expect(reads.get('held')).toBeLessThanOrEqual(2);
  }
});

test('new snapshot transactions are read in batches and only the remainder one by one', async () => {
  const ids = Array.from({ length: 10 }, (_, n) => `t${n}`);
  const batched = jest.fn(async (txids: string[]) => txids.filter(txid => txid !== 't9').map(txid => ({ txid, vsize: 100 })));
  const { mempool, polls, reads } = fixture(gone, ['t9'], [], batched);
  await mempool.$updateMempool(ids, null, [], -1, 2000);
  expect(batched).toHaveBeenCalledWith(ids);
  expect([...reads.keys()]).toEqual(['t9']);
  expect(Object.keys(mempool.getMempool()).sort()).toEqual(ids);
  expect(polls).toEqual([true]);
});
