import EsploraApi from '../api/bitcoin/esplora-api';
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({ bitcoinCoreApi: {} }));
jest.mock('../api/common', () => ({ Common: { isLiquid: () => false } }));
jest.mock('../config', () => ({ __esModule: true, default: {
  MEMPOOL: { NETWORK: 'signet' }, ESPLORA: { REST_API_URL: 'http://127.0.0.1:3000', FALLBACK: [] },
} }));

it('keeps every identity read on the selected host even if ordinary failover selects another', async () => {
  const api = new EsploraApi();
  const router = (api as any).failoverRouter;
  const get = jest.spyOn(router.pollConnection, 'get').mockImplementation(async (url: unknown) => ({ data: String(url).endsWith('/height') ? 10 : 'a'.repeat(64) }));
  const reader = api.$getIdentityReader();
  router.activeHost = { host: 'http://127.0.0.1:3001', socket: false };
  const controller = new AbortController();
  expect(await reader.tip(controller.signal)).toBe(10);
  expect(await reader.hash(0, controller.signal)).toBe('a'.repeat(64));
  expect(get.mock.calls.map(call => call[0])).toEqual(['http://127.0.0.1:3000/blocks/tip/height', 'http://127.0.0.1:3000/block-height/0']);
  expect(get.mock.calls.every(call => (call[1] as any).signal === controller.signal)).toBe(true);
});
it.each(['', '01', '1.5', null, -1])('rejects malformed native index heights %s', async value => {
  const api = new EsploraApi();
  jest.spyOn((api as any).failoverRouter.pollConnection, 'get').mockResolvedValue({ data: value });
  await expect(api.$getIdentityReader().tip(new AbortController().signal)).rejects.toThrow('height');
});
