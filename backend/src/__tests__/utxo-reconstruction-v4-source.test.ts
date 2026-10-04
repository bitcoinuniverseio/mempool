import { createHash } from 'crypto';
import { Transaction } from 'bitcoinjs-lib';
import { EsploraReconstructionV4Source } from '../api/bitcoin/utxo-reconstruction-v4.source';

const get = jest.fn(), rpc = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { isAxiosError: error => error?.isAxiosError === true, create: () => ({ get: (...args) => get(...args) }) } }));
jest.mock('../config', () => ({ __esModule: true, default: {
  MEMPOOL: { NETWORK: 'signet', BACKEND: 'esplora' }, ESPLORA: { REST_API_URL: 'http://127.0.0.1:38300', UNIX_SOCKET_PATH: '' },
} }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: { rpc: { call: (...args) => rpc(...args) } } }));
function transaction(n = 1): Transaction {
  const tx = new Transaction(); tx.addInput(Buffer.alloc(32, n), 0); tx.addOutput(Buffer.from('51', 'hex'), 1); return tx;
}
beforeEach(() => { get.mockReset(); rpc.mockReset(); });
it('binds requested IDs to byte-identical independent native payloads and their raw-byte digest', async () => {
  const tx = transaction(), raw = tx.toHex(); rpc.mockResolvedValue(raw); get.mockResolvedValue({ data: raw });
  const signal = new AbortController().signal, result = await new EsploraReconstructionV4Source().globalTransactions([tx.getId()], signal);
  expect(result).toEqual([{ txid: tx.getId(), rawHex: raw, rawSha256: createHash('sha256').update(Buffer.from(raw, 'hex')).digest('hex') }]);
  expect(rpc).toHaveBeenCalledWith('getrawtransaction', [tx.getId(), false], { signal });
  expect(get).toHaveBeenCalledWith('http://127.0.0.1:38300/tx/' + tx.getId() + '/hex', expect.objectContaining({ signal }));
});
it.each(['different', 'identifier', 'malformed', 'oversized'])('rejects %s native payload instead of proving unrelatedness', async kind => {
  const tx = transaction(), raw = tx.toHex();
  rpc.mockResolvedValue(kind === 'malformed' ? 'zz'.repeat(50) : kind === 'oversized' ? '00'.repeat(524289) : raw);
  get.mockResolvedValue({ data: kind === 'different' ? transaction(2).toHex() : kind === 'malformed' ? 'zz'.repeat(50) : kind === 'oversized' ? '00'.repeat(524289) : raw });
  await expect(new EsploraReconstructionV4Source().globalTransactions([kind === 'identifier' ? 'f'.repeat(64) : tx.getId()], new AbortController().signal)).rejects.toMatchObject({ status: 409 });
});
it('rejects invalid/duplicate/overbound requests before native IO', async () => {
  const source = new EsploraReconstructionV4Source();
  for (const ids of [['../private'], ['a'.repeat(64), 'a'.repeat(64)], Array.from({ length: 101 }, (_, n) => n.toString(16).padStart(64, '0'))]) {
    await expect(source.globalTransactions(ids, new AbortController().signal)).rejects.toMatchObject({ status: 422 });
  }
  expect(rpc).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
});
it('bounds dispatch to four dual-source transactions and waits for the complete wave', async () => {
  const txs = Array.from({ length: 5 }, (_, n) => transaction(n + 1)), map = new Map(txs.map(tx => [tx.getId(), tx.toHex()]));
  const releases: (() => void)[] = [];
  rpc.mockImplementation((_method, [id]) => new Promise(resolve => releases.push(() => resolve(map.get(id)))));
  get.mockImplementation(async url => ({ data: map.get(url.split('/')[4]) }));
  const pending = new EsploraReconstructionV4Source().globalTransactions(txs.map(tx => tx.getId()), new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve)); expect(rpc).toHaveBeenCalledTimes(4); releases.splice(0).forEach(release => release());
  await new Promise(resolve => setImmediate(resolve)); expect(rpc).toHaveBeenCalledTimes(5); releases.splice(0).forEach(release => release());
  expect(await pending).toHaveLength(5);
});
it('does not dispatch a later wave or return a proof after a native reply ignores cancellation', async () => {
  const controller = new AbortController(), tx = transaction();
  rpc.mockImplementation(async () => { controller.abort(); return tx.toHex(); }); get.mockResolvedValue({ data: tx.toHex() });
  await expect(new EsploraReconstructionV4Source().globalTransactions([tx.getId()], controller.signal)).rejects.toMatchObject({ status: 499 });
});
