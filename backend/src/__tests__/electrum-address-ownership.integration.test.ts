import axios from 'axios';
import BitcoindElectrsApi from '../api/bitcoin/electrum-api';
import { addressBitcoinClient } from '../api/bitcoin/bitcoin-client';
import { addressReadAdmission } from '../api/bitcoin/address-read-admission';
import Client from '@mempool/electrum-client';

jest.mock('axios', () => ({ __esModule: true, default: { create: jest.fn(() => ({ get: jest.fn() })) } }));
jest.mock('@mempool/electrum-client', () => jest.fn());
jest.mock('../api/bitcoin/bitcoin-api', () => ({ __esModule: true, default: class {} }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ addressBitcoinClient: { rpc: { call: jest.fn() } } }));
jest.mock('../config', () => ({ __esModule: true, default: { MEMPOOL: { NETWORK: 'signet' },
  ELECTRUM: { ADDRESS_HTTP_URL: 'http://127.0.0.1:3022', HOST: '127.0.0.1', PORT: 50013 }, ESPLORA: { MAX_BEHIND_TIP: 2 } } }));
const hash = (height: number): string => height.toString(16).padStart(64, '0');
const turn = async (): Promise<void> => { for (let index = 0; index < 30; index++) { await Promise.resolve(); } };

it('real adapter direct capability and route inheritance share two raw-owner leases and discard stale replies', async () => {
  jest.useFakeTimers(); process.env.UNIVERSE_SIGNET_CHALLENGE = '51';
  const raw: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
  const request = jest.fn(() => raw.length < 2 ? new Promise((resolve, reject) => raw.push({ resolve, reject }))
    : Promise.resolve({ confirmed: 100, unconfirmed: 0 }));
  (Client as unknown as jest.Mock).mockImplementation(() => ({ initElectrum: (): Promise<void> => Promise.resolve(), request }));
  (addressBitcoinClient.rpc.call as jest.Mock).mockImplementation(async (method, params) => method === 'validateaddress'
    ? { isvalid: true, scriptPubKey: '51' } : method === 'getblockchaininfo'
      ? { chain: 'signet', blocks: 20, bestblockhash: hash(20), signet_challenge: '51' } : hash(params[0]));
  // Field initialization creates the HTTP client when the actual adapter is constructed.
  const api = new BitcoindElectrsApi({});
  const connection = (axios.create as jest.Mock).mock.results.slice(-1)[0].value;
  connection.get.mockImplementation(async (url: string) => ({ data: url.endsWith('/blocks/tip/height') ? '20'
    : url.includes('/block-height/') ? hash(Number(url.split('/').pop())) : JSON.stringify({ address: decodeURIComponent(url.split('/').pop() ?? ''),
      chain_stats: { funded_txo_count: 1, funded_txo_sum: 100, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
      mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 } }) }));
  const first = new AbortController(), second = new AbortController();
  const direct = api.$getAddress('old-direct-scope', first.signal).catch(error => error);
  const route = addressReadAdmission.run(() => api.$getAddress('old-route-scope', second.signal)).catch(error => error);
  try {
    await turn(); expect(request).toHaveBeenCalledTimes(2);
    first.abort(); second.abort();
    expect(await direct).toMatchObject({ code: 'ETIMEDOUT' }); expect(await route).toMatchObject({ code: 'ETIMEDOUT' });
    const before = connection.get.mock.calls.length;
    await expect(api.$getAddress('blocked-new-scope')).rejects.toMatchObject({ code: 'EADDRESSBUSY' });
    expect(request).toHaveBeenCalledTimes(2); expect(connection.get).toHaveBeenCalledTimes(before);
    raw[0].resolve({ confirmed: 100, unconfirmed: 0 }); await turn();
    expect(connection.get).toHaveBeenCalledTimes(before);
    await expect(api.$getAddress('fresh-scope')).resolves.toMatchObject({ address: 'fresh-scope', electrum: true });
    raw[1].reject(Error('late old scope error')); await turn();
    await expect(api.$getAddress('another-fresh-scope')).resolves.toMatchObject({ address: 'another-fresh-scope' });
  } finally {
    raw.forEach(owner => owner.resolve({ confirmed: 100, unconfirmed: 0 })); await turn();
    delete process.env.UNIVERSE_SIGNET_CHALLENGE; jest.useRealTimers();
  }
});
