import { defaultMock, isolatedBackend, quietLogger } from '../../test-support/isolated-backend-helper';

function fixture(entry: (txid: string) => Promise<unknown>, fetched: string[]) {
  const config = { MEMPOOL: { BACKEND: 'electrum', CLEAR_PROTECTION_MINUTES: 20 }, ESPLORA: { BATCH_QUERY_BASE_SIZE: 1000 }, REDIS: { ENABLED: false } };
  const mempool = isolatedBackend('api/mempool.ts', {
    '../config': defaultMock(config), '../logger': quietLogger,
    './common': { Common: { stripTransaction: (tx: unknown) => tx } },
    './transaction-utils': defaultMock({ $getMempoolTransactionsExtended: async (txids: string[]) =>
      txids.filter(txid => fetched.includes(txid)).map(txid => ({ txid, vsize: 100 })) }),
    './loading-indicators': defaultMock({ setProgress: () => {} }),
    './bitcoin/bitcoin-client': defaultMock({ getMempoolEntry: entry }),
    './rbf-cache': defaultMock({ freezeLiveBody: () => {}, updateCache: async () => {} }),
  }).default;
  const polls: boolean[] = [];
  mempool.setObservedPollCallback((_added: unknown, _deleted: unknown, complete: boolean) => polls.push(complete));
  return { mempool, polls };
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

test('an unfetched txid the node still holds, or cannot answer for, keeps the poll incomplete', async () => {
  for (const entry of [async () => ({ fees: {} }), () => Promise.reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))]) {
    const { mempool, polls } = fixture(entry, ['a', 'b']);
    await mempool.$updateMempool(['a', 'b', 'held'], null, [], -1, 2000);
    expect(polls).toEqual([false]);
    expect(mempool.isInSync()).toBe(false);
  }
});
