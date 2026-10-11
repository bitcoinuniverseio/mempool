import { isolatedBackend, defaultMock } from '../../test-support/isolated-backend-helper';

const raw = (txid: string) => ({ txid, version: 2, locktime: 0, size: 100, weight: 400, vin: [], vout: [] });

function fixture(call: (calls: { method: string; params: unknown[] }[]) => Promise<unknown[]>) {
  const Api = isolatedBackend('api/bitcoin/bitcoin-api.ts', { '../mempool': defaultMock({ isInSync: () => true }) }).default;
  const client = { rpc: { call: jest.fn(call) }, getMempoolEntry: jest.fn() };
  return { api: new Api(client), client };
}

test('one request carries each transaction and its fee entry', async () => {
  const { api, client } = fixture(async calls => calls.map(({ method, params }) =>
    method === 'getrawtransaction' ? raw(String(params[0])) : { fees: { base: 0.00000321 } }));
  const ids = Array.from({ length: 30 }, (_, n) => `t${n}`);
  const transactions = await api.$getMempoolTransactionsBatched(ids);
  expect(transactions.map((tx: { txid: string }) => tx.txid)).toEqual(ids);
  expect(transactions.every((tx: { fee: number }) => tx.fee === 321)).toBe(true);
  expect(client.rpc.call).toHaveBeenCalledTimes(2);
  expect(client.getMempoolEntry).not.toHaveBeenCalled();
});

test('a batch the node rejects yields nothing while the other batches are kept', async () => {
  const { api } = fixture(async calls => {
    if (calls.some(call => call.params[0] === 't3')) throw Object.assign(new Error('RPC server rejected the request'), { code: -5 });
    return calls.map(({ method, params }) => method === 'getrawtransaction' ? raw(String(params[0])) : { fees: { base: 0.000001 } });
  });
  const transactions = await api.$getMempoolTransactionsBatched(Array.from({ length: 30 }, (_, n) => `t${n}`));
  expect(transactions.map((tx: { txid: string }) => tx.txid)).toEqual(['t25', 't26', 't27', 't28', 't29']);
});
