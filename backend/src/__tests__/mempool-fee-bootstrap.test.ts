import { isolatedBackend, defaultMock } from '../../test-support/isolated-backend-helper';

function fixture(client: unknown) {
  const Api = isolatedBackend('api/bitcoin/bitcoin-api.ts', {
    '../mempool': defaultMock({ isInSync: () => false }),
  }).default;
  const api = new Api(client);
  return (id: string) => api.$appendMempoolFeeData({ txid: id, fee: 0 });
}

test('eight cold transaction reads share one bounded verbose mempool request', async () => {
  let complete!: (value: unknown) => void;
  const client = { getRawMemPool: jest.fn(() => new Promise(resolve => { complete = resolve; })), getMempoolEntry: jest.fn() };
  const read = fixture(client), ids = Array.from({ length: 8 }, (_, n) => String(n));
  const pending = ids.map(read);
  expect(client.getRawMemPool).toHaveBeenCalledTimes(1);
  complete(Object.fromEntries(ids.map(id => [id, { fees: { base: 0.000001 } }])));
  expect((await Promise.all(pending)).map(tx => tx.fee)).toEqual(Array(8).fill(100));
  expect(client.getMempoolEntry).not.toHaveBeenCalled();
});

test('a refused whole-mempool read uses exact entry reads and backs off the bulk request', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  const client = { getRawMemPool: jest.fn().mockRejectedValue(new Error('controlled response limit')), getMempoolEntry: jest.fn().mockResolvedValue({ fees: { base: 0.000002 } }) };
  try {
    const read = fixture(client);
    expect((await Promise.all(Array.from({ length: 8 }, (_, n) => read(String(n))))).map(tx => tx.fee)).toEqual(Array(8).fill(200));
    expect((await read('later')).fee).toBe(200);
    expect(client.getRawMemPool).toHaveBeenCalledTimes(1);
    expect(client.getMempoolEntry).toHaveBeenCalledTimes(9);
    now.mockReturnValue(1030001);
    await read('retry');
    expect(client.getRawMemPool).toHaveBeenCalledTimes(2);
  } finally { now.mockRestore(); }
});

test('failed exact entry reads remain failures rather than fabricated zero fees', async () => {
  const failure = new Error('entry unavailable');
  const client = { getRawMemPool: jest.fn().mockRejectedValue(new Error('bulk unavailable')), getMempoolEntry: jest.fn().mockRejectedValue(failure) };
  await expect(fixture(client)('missing')).rejects.toBe(failure);
});
