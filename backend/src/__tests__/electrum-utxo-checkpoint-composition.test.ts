import BitcoindElectrsApi from '../api/bitcoin/electrum-api';
import { addressBitcoinClient } from '../api/bitcoin/bitcoin-client';
import { verifyAddressSource } from '../api/bitcoin/address-source-checkpoint';
import Client from '@mempool/electrum-client';

jest.mock('@mempool/electrum-client', () => jest.fn());
jest.mock('../api/bitcoin/bitcoin-api', () => ({ __esModule: true, default: class {} }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ addressBitcoinClient: { validateAddress: jest.fn(), rpc: { call: jest.fn() } } }));
jest.mock('../api/bitcoin/address-source-checkpoint', () => ({ verifyAddressSource: jest.fn() }));
jest.mock('../api/memory-cache', () => ({ __esModule: true, default: { get: () => null, set: () => undefined } }));
jest.mock('../config', () => ({ __esModule: true, default: { MEMPOOL: { NETWORK: 'mainnet' }, ELECTRUM: { HOST: '127.0.0.1', PORT: 50011 }, ESPLORA: { MAX_BEHIND_TIP: 2 } } }));
const checkpoint = { blockHeight: 10, blockHash: 'a'.repeat(64), genesisHash: 'b'.repeat(64), network: 'mainnet', signetChallenge: null, verifiedAt: new Date().toISOString() };
const turn = async (): Promise<void> => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function adapter(rows: unknown[] = []) {
  (Client as unknown as jest.Mock).mockImplementation(() => ({ initElectrum: () => Promise.resolve(), blockchainScripthash_listunspent: () => Promise.resolve(rows) }));
  (addressBitcoinClient.validateAddress as jest.Mock).mockResolvedValue({ isvalid: true, scriptPubKey: '51' });
  const api = new BitcoindElectrsApi({});
  jest.spyOn(api, '$getIndexedTip').mockResolvedValue(10);
  return api;
}
afterEach(() => { jest.clearAllMocks(); jest.useRealTimers(); });

it('actual address UTXO adapter finishes within eight seconds while retaining before/after source proof', async () => {
  jest.useFakeTimers();
  (verifyAddressSource as jest.Mock).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(checkpoint), 3000)));
  const api = adapter();
  let deadline: ReturnType<typeof setTimeout>;
  const result = Promise.race([api.$getAddressUtxos('bounded-address'), new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('shared-eight-second-deadline')), 8000); })]);
  const observed = result.then(value => ({ value }), error => ({ error: error.message }));
  await turn();
  for (let i = 0; i < 8; i++) { jest.advanceTimersByTime(1000); await turn(); }
  expect(await observed).toEqual({ value: [] });
  expect(verifyAddressSource).toHaveBeenCalledTimes(2);
  clearTimeout(deadline!);
  jest.clearAllTimers();
});

it('rejects a changed active checkpoint after native unspent acquisition', async () => {
  (verifyAddressSource as jest.Mock).mockResolvedValueOnce(checkpoint).mockResolvedValueOnce({ ...checkpoint, blockHash: 'c'.repeat(64) });
  await expect(adapter().$getAddressUtxos('reorg-address')).rejects.toThrow('Address source changed during UTXO acquisition');
});

it('never turns malformed native unspent rows into empty success', async () => {
  (verifyAddressSource as jest.Mock).mockResolvedValue(checkpoint);
  await expect(adapter([{ tx_hash: 'd'.repeat(64), tx_pos: 0, value: 1, height: -1 }]).$getAddressUtxos('malformed-address')).rejects.toThrow('Invalid indexed UTXO height');
});
