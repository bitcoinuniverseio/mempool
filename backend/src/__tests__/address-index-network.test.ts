jest.mock('../api/bitcoin/bitcoin-client', () => { const reader = {
 getBlockchainInfo:async()=>({chain:({mainnet:'main',testnet:'test',testnet4:'testnet4',signet:'signet',regtest:'regtest'} as any)[require('../config').default.MEMPOOL.NETWORK],blocks:100,bestblockhash:'1'.repeat(64),signet_challenge:require('../config').default.MEMPOOL.NETWORK==='signet'?'51':undefined}),
 getBlockHash:async(height: number)=>height===0?'0'.repeat(64):'1'.repeat(64),
}; return { __esModule: true, default: reader, addressBitcoinClient: reader }; });
import http from 'http';
import { address, networks } from 'bitcoinjs-lib';
import { bech32 } from 'bech32';
import config from '../config';
import { $probeAddressIndex, addressProbeForNetwork, ADDRESS_PROBE } from '../api/bitcoin/address-index';

describe('network-specific address readiness', () => {
  const original = {
    backend: config.MEMPOOL.BACKEND, network: config.MEMPOOL.NETWORK,
    url: config.ESPLORA.REST_API_URL, socket: config.ESPLORA.UNIX_SOCKET_PATH,
  };
  let server: http.Server;
  let responses: 'valid' | 'wrong-address' | 'bad-utxo' | 'lagging' = 'valid';
  const requests: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url!;
      requests.push(path);
      res.setHeader('content-type', 'application/json');
      if (path.startsWith('/block-height/')) { res.end(JSON.stringify(path === '/block-height/0' ? '0'.repeat(64) : '1'.repeat(64))); return; }
      if (path === '/blocks/tip/height') {
        res.end(JSON.stringify(responses === 'lagging' ? 90 : 100));
        return;
      }
      const expected = addressProbeForNetwork(config.MEMPOOL.NETWORK);
      if (path === `/address/${expected}/utxo`) {
        res.end(JSON.stringify(responses === 'bad-utxo' ? [{}] : []));
      } else if (path === `/address/${expected}`) {
        const stats = { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 };
        res.end(JSON.stringify({ address: responses === 'wrong-address' ? ADDRESS_PROBE : expected,
          chain_stats: stats, mempool_stats: stats }));
      } else {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Address on invalid network' }));
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    config.MEMPOOL.BACKEND = 'esplora';
    config.ESPLORA.UNIX_SOCKET_PATH = '';
    config.ESPLORA.REST_API_URL = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
  });
  afterAll(async () => {
    config.MEMPOOL.BACKEND = original.backend;
    config.MEMPOOL.NETWORK = original.network;
    config.ESPLORA.REST_API_URL = original.url;
    config.ESPLORA.UNIX_SOCKET_PATH = original.socket;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  beforeEach(() => { process.env.UNIVERSE_SIGNET_CHALLENGE='51'; responses = 'valid'; requests.length = 0; config.MEMPOOL.NETWORK = 'signet'; });

  it.each(['testnet', 'testnet4', 'signet', 'regtest'] as const)('sends valid %s addresses through the primary HTTP client', async network => {
    config.MEMPOOL.NETWORK = network;
    const probe = addressProbeForNetwork(network);
    expect(() => address.toOutputScript(probe, network === 'regtest' ? networks.regtest : networks.testnet)).not.toThrow();
    const result = await $probeAddressIndex(100);
    expect(result.state).toBe('ready');
    expect(requests).toEqual(['/blocks/tip/height', `/address/${probe}`, `/address/${probe}/utxo`, '/block-height/0', '/block-height/100']);
  });
  it('preserves the existing mainnet probe', () => {
    expect(addressProbeForNetwork('mainnet')).toBe(ADDRESS_PROBE);
    expect(() => address.toOutputScript(ADDRESS_PROBE, networks.bitcoin)).not.toThrow();
  });
  it.each([['liquid', 'ex'], ['liquidtestnet', 'tex']])('encodes a checksummed %s witness address', (network, prefix) => {
    const decoded = bech32.decode(addressProbeForNetwork(network));
    expect(decoded.prefix).toBe(prefix);
    expect(decoded.words[0]).toBe(0);
    expect(bech32.fromWords(decoded.words.slice(1))).toHaveLength(20);
  });
  it('rejects an unknown chain instead of silently querying mainnet', () => {
    expect(() => addressProbeForNetwork('unknown')).toThrow('Unsupported address probe network');
  });
  it.each(['wrong-address', 'bad-utxo'] as const)('keeps malformed %s data degraded', async mode => {
    responses = mode;
    expect((await $probeAddressIndex(100)).state).toBe('degraded');
  });
  it('does not mask a lagging index with successful address reads', async () => {
    responses = 'lagging';
    expect((await $probeAddressIndex(100)).state).toBe('syncing');
  });
});
