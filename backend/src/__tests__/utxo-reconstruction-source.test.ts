import { EsploraReconstructionSource } from '../api/bitcoin/utxo-reconstruction.source';

const get = jest.fn(), post = jest.fn(), rpc = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { isAxiosError: error => error?.isAxiosError === true, create: () => ({ get: (...args) => get(...args), post: (...args) => post(...args) }) } }));
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
    : url.endsWith('/block-height/20') ? id(20) : url.endsWith('/block-height/19') ? id(19) : url.endsWith('/mempool/txids') ? [id(30)]
    : { address: 'address', chain_stats: {}, mempool_stats: {} } }));
  const answer = (method: string, params: any[]) => method === 'getblockchaininfo' ? { ...info }
    : method === 'getblockhash' ? id(params[0]) : method === 'getrawmempool' ? { txids: [id(30)], mempool_sequence: 5 }
    : method === 'validateaddress' ? { isvalid: true, scriptPubKey: script }
    : { value: 0.0000007, confirmations: 1, bestblock: id(20), scriptPubKey: { hex: script } };
  rpc.mockImplementation(async (method, params) => Array.isArray(method) ? method.map(call => answer(call.method, call.params)) : answer(method, params));
});
afterAll(() => { if (originalChallenge === undefined) delete process.env.UNIVERSE_SIGNET_CHALLENGE; else process.env.UNIVERSE_SIGNET_CHALLENGE = originalChallenge; });
it('checks all distinct confirmed history heights in independent ordered batches of at most twenty', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ status: { confirmed: true, block_height: i, block_hash: id(i) } })) as any[];
  await new EsploraReconstructionSource().verifyHistoryBlocks(rows, new AbortController().signal);
  expect(rpc).toHaveBeenCalledTimes(5);
  expect(rpc.mock.calls.every(([calls]) => calls.length === 20 && calls.every(call => call.method === 'getblockhash'))).toBe(true);
});
it('rejects a history block that differs from independently observed canonical Core', async () => {
  await expect(new EsploraReconstructionSource().verifyHistoryBlocks([{ status: { confirmed: true, block_height: 1, block_hash: id(99) } }] as any[], new AbortController().signal)).rejects.toMatchObject({ status: 409 });
});
it('rejects oversized or inconsistent history proofs before any independent Core request', async () => {
  const source = new EsploraReconstructionSource(), controller = new AbortController();
  await expect(source.verifyHistoryBlocks(Array.from({ length: 101 }, () => ({ status: { confirmed: true, block_height: 1, block_hash: id(1) } })) as any[], controller.signal)).rejects.toMatchObject({ status: 422 });
  await expect(source.verifyHistoryBlocks([{ status: { confirmed: true, block_height: 1, block_hash: id(1) } }, { status: { confirmed: true, block_height: 1, block_hash: id(2) } }] as any[], controller.signal)).rejects.toMatchObject({ status: 409 });
  controller.abort(); await expect(source.verifyHistoryBlocks([], controller.signal)).rejects.toMatchObject({ status: 499 });
  expect(rpc).not.toHaveBeenCalled();
});
it('pins the configured origin and compares exact Core/index mempool identities', async () => {
  const snapshot = await new EsploraReconstructionSource().snapshot('address', new AbortController().signal);
  expect(snapshot.checkpoint.blockHash).toBe(id(20)); expect(snapshot.scriptPubKey).toBe(script);
  expect(snapshot.mempoolIdentity).toMatch(/^[0-9a-f]{64}$/);
  expect(get.mock.calls.every(([url]) => url.startsWith('http://127.0.0.1:38300/'))).toBe(true);
});
it('acquires a chain-only anchor without asserting global mempool stability', async () => {
  const snapshot = await new EsploraReconstructionSource().confirmedSnapshot('address', new AbortController().signal);
  expect(snapshot.mempoolIdentity).toBeNull(); expect(snapshot.checkpoint.blockHash).toBe(id(20));
  expect(rpc.mock.calls.some(([method]) => method === 'getrawmempool')).toBe(false);
  expect(get.mock.calls.some(([url]) => url.endsWith('/mempool/txids'))).toBe(false);
});
it('independently checks the original confirmed anchor in both real source interfaces', async () => {
  const anchor = { network: 'signet', genesisHash: id(0), blockHeight: 19, blockHash: id(19), signetChallenge: '51', verifiedAt: new Date().toISOString() };
  const snapshot = await new EsploraReconstructionSource().confirmedSnapshot('address', new AbortController().signal, anchor);
  expect(snapshot.canonicalAnchor).toEqual({ heightAtomic: '19', blockHash: id(19) }); expect(snapshot.checkpoint.blockHeight).toBe(20);
  expect(rpc).toHaveBeenCalledWith('getblockhash', [19], expect.anything());
  expect(get).toHaveBeenCalledWith('http://127.0.0.1:38300/block-height/19', expect.anything());
});
it.each(['core', 'index'])('rejects original-anchor reorg in %s even when the latest shared tip matches', async side => {
  const anchor = { network: 'signet', genesisHash: id(0), blockHeight: 19, blockHash: id(19), signetChallenge: '51', verifiedAt: new Date().toISOString() };
  if (side === 'core') rpc.mockImplementation(async (method, params) => method === 'getblockchaininfo' ? { ...info } : method === 'getblockhash' ? id(params[0] === 19 ? 99 : params[0]) : {});
  else {
    const implementation = get.getMockImplementation()!;
    get.mockImplementation(async (url, options) => url.endsWith('/block-height/19') ? { data: id(99) } : implementation(url, options));
  }
  await expect(new EsploraReconstructionSource().confirmedSnapshot('address', new AbortController().signal, anchor)).rejects.toThrow('Original confirmed anchor is no longer canonical');
  expect(get.mock.calls.some(([url]) => url.includes('/address/'))).toBe(false);
});
it('captures the actual history acquisition phase and timeout without leaking raw diagnostics', async () => {
  get.mockRejectedValueOnce(Object.assign(new Error('private configured origin diagnostic'), { isAxiosError: true, code: 'ECONNABORTED', response: { status: 429 } }));
  await expect(new EsploraReconstructionSource().history('address', id(1), 100, new AbortController().signal)).rejects.toMatchObject({
    status: 504, phase: 'confirmed-history', causeCode: 'DEADLINE', upstreamStatus: 429, message: 'Bounded reconstruction source acquisition failed',
  });
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
  expect(rpc).toHaveBeenCalledWith([{ method: 'gettxout', params: [id(1), 0, true] }], [], expect.anything());
  rpc.mockResolvedValueOnce([id(20)]).mockResolvedValueOnce([{ value: 0.00000071, confirmations: 1, bestblock: id(20), scriptPubKey: { hex: script } }]);
  await expect(new EsploraReconstructionSource().verifyOutputs([output], new AbortController().signal, checkpoint)).rejects.toMatchObject({ status: 409 });
  post.mockResolvedValueOnce({ data: [] });
  await expect(new EsploraReconstructionSource().verifyOutputs([output], new AbortController().signal, checkpoint)).rejects.toMatchObject({ status: 409 });
});
it('bounds live Core batches and verifies every one of one hundred outputs', async () => {
  const outputs = Array.from({ length: 100 }, (_, n) => ({ txid: id(n + 1), vout: 0, value: 70, scriptpubkey: script, status: { confirmed: true, block_height: 20, block_hash: id(20), block_time: 1 } }));
  const checkpoint = { network: 'signet', blockHeight: 20, blockHash: id(20), genesisHash: id(0), signetChallenge: '51', verifiedAt: new Date().toISOString() };
  post.mockResolvedValue({ data: outputs.map(() => ({ spent: false })) });
  await new EsploraReconstructionSource().verifyOutputs(outputs, new AbortController().signal, checkpoint);
  const calls = rpc.mock.calls.map(([batch]) => batch);
  expect(calls.every(batch => Array.isArray(batch) && batch.length <= 20)).toBe(true);
  expect(calls.flat().filter(call => call.method === 'gettxout')).toHaveLength(100);
  expect(calls.flat().filter(call => call.method === 'getblockhash')).toHaveLength(1);
});
it('rejects malformed batch cardinality and never dispatches after an ignored cancellation', async () => {
  const outputs = Array.from({ length: 21 }, (_, n) => ({ txid: id(n + 1), vout: 0, value: 70, scriptpubkey: script, status: { confirmed: false } }));
  const checkpoint = { network: 'signet', blockHeight: 20, blockHash: id(20), genesisHash: id(0), signetChallenge: '51', verifiedAt: new Date().toISOString() };
  post.mockResolvedValue({ data: outputs.map(() => ({ spent: false })) }); rpc.mockResolvedValueOnce([]);
  await expect(new EsploraReconstructionSource().verifyOutputs(outputs, new AbortController().signal, checkpoint)).rejects.toMatchObject({ status: 409 });
  const controller = new AbortController(); let release!: () => void; rpc.mockClear();
  rpc.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(Array(20).fill({ value: 0.0000007, confirmations: 0, bestblock: id(20), scriptPubKey: { hex: script } })); }));
  const pending = new EsploraReconstructionSource().verifyOutputs(outputs, controller.signal, checkpoint);
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); release();
  await expect(pending).rejects.toMatchObject({ status: 499 }); expect(rpc).toHaveBeenCalledTimes(1);
});
