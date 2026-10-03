import { EsploraReconstructionSource } from '../api/bitcoin/utxo-reconstruction.source';

const get = jest.fn(), post = jest.fn(), rpc = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { create: () => ({ get: (...args) => get(...args), post: (...args) => post(...args) }) } }));
jest.mock('../config', () => ({ __esModule: true, default: {
  MEMPOOL: { NETWORK: 'signet', BACKEND: 'esplora' }, ESPLORA: { REST_API_URL: 'http://127.0.0.1:38300', UNIX_SOCKET_PATH: '' },
} }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: { rpc: { call: (...args) => rpc(...args) } } }));
const id = (n: number) => n.toString(16).padStart(64, '0'), script = '0014' + 'a'.repeat(40);
const originalChallenge = process.env.UNIVERSE_SIGNET_CHALLENGE;
const info = { chain: 'signet', blocks: 20, bestblockhash: id(20), signet_challenge: '51', initialblockdownload: false };
beforeEach(() => {
  process.env.UNIVERSE_SIGNET_CHALLENGE = '51'; get.mockReset(); post.mockReset(); rpc.mockReset();
  get.mockImplementation(async (url: string) => ({ data: url.endsWith('/blocks/tip/height') ? '20'
    : url.endsWith('/blocks/tip/hash') ? id(20) : url.endsWith('/block-height/0') ? id(0)
    : url.endsWith('/block-height/20') ? id(20) : url.endsWith('/mempool/txids') ? [id(30)]
    : { address: 'address', chain_stats: {}, mempool_stats: {} } }));
  rpc.mockImplementation(async (method: string, params: any[]) => method === 'getblockchaininfo' ? { ...info }
    : method === 'getblockhash' ? id(params[0]) : method === 'getrawmempool' ? { txids: [id(30)], mempool_sequence: 5 }
    : method === 'validateaddress' ? { isvalid: true, scriptPubKey: script }
    : { value: 0.0000007, confirmations: 1, bestblock: id(20), scriptPubKey: { hex: script } });
});
afterAll(() => { if (originalChallenge === undefined) delete process.env.UNIVERSE_SIGNET_CHALLENGE; else process.env.UNIVERSE_SIGNET_CHALLENGE = originalChallenge; });
it('pins the configured origin and compares exact Core/index mempool identities', async () => {
  const snapshot = await new EsploraReconstructionSource().snapshot('address', new AbortController().signal);
  expect(snapshot.checkpoint.blockHash).toBe(id(20)); expect(snapshot.scriptPubKey).toBe(script);
  expect(snapshot.mempoolIdentity).toMatch(/^[0-9a-f]{64}$/);
  expect(get.mock.calls.every(([url]) => url.startsWith('http://127.0.0.1:38300/'))).toBe(true);
});
it('rejects missing IBD and a mismatched configured Signet challenge', async () => {
  rpc.mockResolvedValueOnce({ ...info, initialblockdownload: undefined });
  await expect(new EsploraReconstructionSource().snapshot('address', new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  process.env.UNIVERSE_SIGNET_CHALLENGE = '52';
  await expect(new EsploraReconstructionSource().snapshot('address', new AbortController().signal)).rejects.toThrow(/challenge/);
});
it('rejects an omitted indexed mempool transaction instead of treating equal counts as identity', async () => {
  get.mockImplementation(async (url: string) => ({ data: url.endsWith('/blocks/tip/height') ? '20'
    : url.endsWith('/block-height/0') ? id(0) : url.endsWith('/block-height/20') ? id(20)
    : url.endsWith('/mempool/txids') ? [id(31)] : {} }));
  await expect(new EsploraReconstructionSource().snapshot('address', new AbortController().signal)).rejects.toMatchObject({ status: 409 });
});
it('stops new reads when a late HTTP reply ignores cancellation', async () => {
  const controller = new AbortController(); let release!: () => void;
  get.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ data: '20' }); }));
  const pending = new EsploraReconstructionSource().snapshot('address', controller.signal);
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); release();
  await expect(pending).rejects.toMatchObject({ status: 499 }); expect(rpc).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1);
});
it('requires every index outspend and independently read Core amount/script/status', async () => {
  const output = { txid: id(1), vout: 0, value: 70, scriptpubkey: script, status: { confirmed: true, block_height: 20, block_hash: id(20), block_time: 1 } };
  const checkpoint = { network: 'signet', blockHeight: 20, blockHash: id(20), genesisHash: id(0), signetChallenge: '51', verifiedAt: new Date().toISOString() };
  post.mockResolvedValue({ data: [{ spent: false }] });
  await new EsploraReconstructionSource().verifyOutputs([output], new AbortController().signal, checkpoint);
  expect(rpc).toHaveBeenCalledWith('gettxout', [id(1), 0, true], expect.anything());
  rpc.mockResolvedValueOnce({ value: 0.00000071, confirmations: 1, bestblock: id(20), scriptPubKey: { hex: script } });
  await expect(new EsploraReconstructionSource().verifyOutputs([output], new AbortController().signal, checkpoint)).rejects.toMatchObject({ status: 409 });
  post.mockResolvedValueOnce({ data: [] });
  await expect(new EsploraReconstructionSource().verifyOutputs([output], new AbortController().signal, checkpoint)).rejects.toMatchObject({ status: 409 });
});
