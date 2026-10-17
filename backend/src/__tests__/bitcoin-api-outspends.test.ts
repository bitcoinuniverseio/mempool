import { isolatedBackend, defaultMock } from '../../test-support/isolated-backend-helper';
import * as outspendSource from '../api/bitcoin/outspend-source';

const SOURCE = 'aa'.repeat(32);
const SPENDER_A = 'bb'.repeat(32);
const SPENDER_B = 'cc'.repeat(32);
const BLOCK = 'dd'.repeat(32);

// Outputs: 0 spent in a block, 1 spent in the mempool, 2 unspent, 3 OP_RETURN.
const sourceTx = () => ({
  txid: SOURCE,
  vin: [],
  vout: [
    { value: 0.0001, scriptPubKey: { type: 'witness_v1_taproot' } },
    { value: 0.0002, scriptPubKey: { type: 'witness_v0_keyhash' } },
    { value: 0.0003, scriptPubKey: { type: 'witness_v0_keyhash' } },
    { value: 0, scriptPubKey: { type: 'nulldata' } },
  ],
});
const utxoSet = new Set([2]);
const LEGACY = [{ spent: true }, { spent: true }, { spent: false }, { spent: true }];
const CONFIRMED = { confirmed: true, block_height: 900000, block_hash: BLOCK, block_time: 1760000000 };

const esploraAnswer = () => [
  { spent: true, txid: SPENDER_A, vin: 1, status: CONFIRMED },
  { spent: true, txid: SPENDER_B, vin: 0, status: { confirmed: false } },
  { spent: false },
  { spent: false },
];

type Rpc = (method: string, params: any[]) => Promise<any>;
const methodNotFound: Rpc = async () => { throw Object.assign(new Error('RPC server rejected the request'), { code: -32601 }); };

function fixture(options: { http?: (path: string) => Promise<any>; rpc?: Rpc; restUrl?: string } = {}) {
  const get = jest.fn(options.http || (async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); }));
  const axios = { __esModule: true, default: { create: () => ({ get: (url: string) => get(url.replace(/^https?:\/\/[^/]+/, '')) }) } };
  const config = defaultMock({ ESPLORA: { REST_API_URL: options.restUrl ?? 'http://127.0.0.1:3000', UNIX_SOCKET_PATH: null, REQUEST_TIMEOUT: 1000 } });
  const Api = isolatedBackend('api/bitcoin/bitcoin-api.ts', {
    '../mempool': defaultMock({ getMempool: () => ({}) }),
    '../../config': config,
    'axios': axios,
    './outspend-source': outspendSource,
  }).default;
  const client = {
    getRawTransaction: jest.fn(async (txid: string) => {
      if (txid === SOURCE) return sourceTx();
      throw Object.assign(new Error('No such mempool or blockchain transaction'), { code: -5 });
    }),
    getTxOut: jest.fn(async (txid: string, vout: number) => (txid === SOURCE && utxoSet.has(vout) ? { value: 0.0003 } : null)),
    rpc: { call: jest.fn(options.rpc || methodNotFound) },
  };
  return { api: new Api(client), client, get };
}

describe('path 1: owned Esplora HTTP API', () => {
  test('returns the stated spenders, confirmed and mempool, and checks unstated outputs against the UTXO set', async () => {
    const { api, client, get } = fixture({ http: async () => ({ status: 200, data: esploraAnswer() }) });
    const result = await api.$getOutspends(SOURCE);
    expect(get).toHaveBeenCalledWith(`/tx/${SOURCE}/outspends`);
    expect(result).toEqual([
      { spent: true, txid: SPENDER_A, vin: 1, status: CONFIRMED },
      { spent: true, txid: SPENDER_B, vin: 0, status: { confirmed: false } },
      { spent: false },
      { spent: false },
    ]);
    // Only the spendable output the index called unspent is rechecked.
    expect(client.getTxOut.mock.calls).toEqual([[SOURCE, 2]]);
    expect(client.rpc.call).not.toHaveBeenCalled();
  });

  test('an index that lags never turns a spent output into unspent, and no spender is invented', async () => {
    const lagging = esploraAnswer();
    lagging[0] = { spent: false } as any;
    const { api } = fixture({ http: async () => ({ status: 200, data: lagging }) });
    const result = await api.$getOutspends(SOURCE);
    expect(result[0]).toEqual({ spent: true });
  });

  test.each([
    ['too few entries', (a: any[]) => a.slice(0, 3)],
    ['too many entries', (a: any[]) => [...a, { spent: false }]],
    ['not an array', () => ({ spent: true })],
    ['non-hex txid', (a: any[]) => { a[0].txid = 'zz'.repeat(32); return a; }],
    ['short txid', (a: any[]) => { a[0].txid = 'bb'; return a; }],
    ['fractional vin', (a: any[]) => { a[0].vin = 1.5; return a; }],
    ['negative vin', (a: any[]) => { a[0].vin = -1; return a; }],
    ['missing status', (a: any[]) => { delete a[0].status; return a; }],
    ['confirmed status without a height', (a: any[]) => { a[0].status = { confirmed: true, block_hash: BLOCK }; return a; }],
    ['non-boolean spent', (a: any[]) => { a[2].spent = 'no'; return a; }],
  ])('an answer with %s falls back to the spent flag only', async (_name, mutate) => {
    const { api } = fixture({ http: async () => ({ status: 200, data: mutate(esploraAnswer()) }) });
    expect(await api.$getOutspends(SOURCE)).toEqual(LEGACY);
  });

  test('a non-200 answer falls back to the spent flag only', async () => {
    const { api } = fixture({ http: async () => ({ status: 404, data: 'Transaction not found' }) });
    expect(await api.$getOutspends(SOURCE)).toEqual(LEGACY);
  });

  test('an unreachable API is not asked again until the retry window passes', async () => {
    const { api, get } = fixture();
    expect(await api.$getOutspends(SOURCE)).toEqual(LEGACY);
    expect(await api.$getOutspends(SOURCE)).toEqual(LEGACY);
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('outspends by outpoint use the API once per transaction and keep the request order', async () => {
    const { api, get } = fixture({ http: async () => ({ status: 200, data: esploraAnswer() }) });
    const result = await api.$getOutSpendsByOutpoint([{ txid: SOURCE, vout: 1 }, { txid: SOURCE, vout: 0 }]);
    expect(result).toEqual([
      { spent: true, txid: SPENDER_B, vin: 0, status: { confirmed: false } },
      { spent: true, txid: SPENDER_A, vin: 1, status: CONFIRMED },
    ]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('batched outspends carry the spenders', async () => {
    const { api } = fixture({ http: async () => ({ status: 200, data: esploraAnswer() }) });
    const [result] = await api.$getBatchedOutspends([SOURCE]);
    expect(result[0]).toEqual({ spent: true, txid: SPENDER_A, vin: 1, status: CONFIRMED });
  });
});

describe('path 2: Bitcoin Core gettxspendingprevout with -txospenderindex', () => {
  const spenderTx = (txid: string, vin: { txid: string; vout: number }[], block?: string) => ({
    txid, vin, vout: [], ...(block ? { blockhash: block, confirmations: 3, in_active_chain: true } : {}),
  });
  const coreRpc = (overrides: Partial<Record<string, Rpc>> = {}): Rpc => async (method, params) => {
    if (overrides[method]) return overrides[method]!(method, params);
    switch (method) {
      case 'gettxspendingprevout':
        return params[0].map((o: any) => ({
          ...o,
          ...(o.vout === 0 ? { spendingtxid: SPENDER_A, blockhash: BLOCK } : o.vout === 1 ? { spendingtxid: SPENDER_B } : {}),
        }));
      case 'getrawtransaction':
        if (params[0] === SPENDER_A) return spenderTx(SPENDER_A, [{ txid: 'ee'.repeat(32), vout: 0 }, { txid: SOURCE, vout: 0 }], BLOCK);
        if (params[0] === SPENDER_B) return spenderTx(SPENDER_B, [{ txid: SOURCE, vout: 1 }]);
        throw Object.assign(new Error('No such mempool or blockchain transaction'), { code: -5 });
      case 'getblockheader':
        return { hash: params[0], height: 900000, time: 1760000000, confirmations: 3 };
    }
    throw new Error('unexpected ' + method);
  };

  test('maps spendingtxid to the spender, finds the input and reads the status from the spending transaction', async () => {
    const { api, client, get } = fixture({ restUrl: '', rpc: coreRpc() });
    const result = await api.$getOutspends(SOURCE);
    expect(get).not.toHaveBeenCalled();
    expect(result).toEqual([
      { spent: true, txid: SPENDER_A, vin: 1, status: CONFIRMED },
      { spent: true, txid: SPENDER_B, vin: 0, status: { confirmed: false } },
      { spent: false },
      { spent: false },
    ]);
    const spending = client.rpc.call.mock.calls.filter(([m]: any[]) => m === 'gettxspendingprevout');
    expect(spending).toEqual([['gettxspendingprevout', [[0, 1, 2, 3].map(vout => ({ txid: SOURCE, vout })), { mempool_only: false }]]]);
    expect(client.rpc.call).toHaveBeenCalledWith('getrawtransaction', [SPENDER_A, true, BLOCK]);
    expect(client.getTxOut.mock.calls).toEqual([[SOURCE, 2]]);
  });

  test('is used when the HTTP API answers out of contract', async () => {
    const { api } = fixture({ http: async () => ({ status: 200, data: [] }), rpc: coreRpc() });
    expect((await api.$getOutspends(SOURCE))[0]).toEqual({ spent: true, txid: SPENDER_A, vin: 1, status: CONFIRMED });
  });

  test('a spending transaction without the input keeps the spent flag and invents nothing', async () => {
    const { api } = fixture({ restUrl: '', rpc: coreRpc({ getrawtransaction: async () => spenderTx(SPENDER_A, [{ txid: SOURCE, vout: 7 }], BLOCK) }) });
    const result = await api.$getOutspends(SOURCE);
    expect(result[0]).toEqual({ spent: true });
  });

  test('an unreadable spending transaction keeps the spent flag only', async () => {
    const { api } = fixture({ restUrl: '', rpc: coreRpc({ getrawtransaction: methodNotFound }) });
    const result = await api.$getOutspends(SOURCE);
    expect(result.slice(0, 2)).toEqual([{ spent: true }, { spent: true }]);
  });

  test('rows that do not match the request fall back to the spent flag only', async () => {
    const { api } = fixture({ restUrl: '', rpc: coreRpc({ gettxspendingprevout: async () => [{ txid: SOURCE, vout: 0, spendingtxid: 'bad' }] }) });
    expect(await api.$getOutspends(SOURCE)).toEqual(LEGACY);
  });

  test('a node without the index is detected once and the capability is cached', async () => {
    const { api, client } = fixture({ restUrl: '' });
    expect(await api.$getOutspends(SOURCE)).toEqual(LEGACY);
    expect(await api.$getOutspends(SOURCE)).toEqual(LEGACY);
    expect(client.rpc.call).toHaveBeenCalledTimes(1);
    // With no source left, the transaction is read once per call, as before.
    expect(client.getRawTransaction).toHaveBeenCalledTimes(3);
  });

  test('a transport failure is not taken as a missing capability', async () => {
    let calls = 0;
    const { api } = fixture({ restUrl: '', rpc: coreRpc({ gettxspendingprevout: async (m, p) => {
      if (calls++ === 0) throw Object.assign(new Error('RPC operation exceeded its deadline'), { code: 'ETIMEDOUT' });
      return coreRpc()(m, p);
    } }) });
    expect(await api.$getOutspends(SOURCE)).toEqual(LEGACY);
    expect((await api.$getOutspends(SOURCE))[1]).toEqual({ spent: true, txid: SPENDER_B, vin: 0, status: { confirmed: false } });
  });

  test('a spender in a block that is no longer active keeps the spent flag only', async () => {
    const { api } = fixture({ restUrl: '', rpc: coreRpc({ getrawtransaction: async () => ({ ...spenderTx(SPENDER_A, [{ txid: SOURCE, vout: 0 }], BLOCK), in_active_chain: false }) }) });
    expect((await api.$getOutspends(SOURCE))[0]).toEqual({ spent: true });
  });
});

describe('path 3: no spender source', () => {
  test('keeps the spent-flag-only reading exactly', async () => {
    const { api, client } = fixture();
    expect(await api.$getOutspends(SOURCE)).toEqual(LEGACY);
    expect(client.getTxOut.mock.calls).toEqual([0, 1, 2, 3].map(vout => [SOURCE, vout]));
  });

  test('outspends by outpoint keep the per-output reading', async () => {
    const { api } = fixture();
    expect(await api.$getOutSpendsByOutpoint([{ txid: SOURCE, vout: 2 }, { txid: SOURCE, vout: 0 }])).toEqual([
      { spent: false, status: { confirmed: true } },
      { spent: true, status: { confirmed: true } },
    ]);
  });

  test('an unknown transaction still fails as before', async () => {
    const { api } = fixture();
    await expect(api.$getOutspends('ff'.repeat(32))).rejects.toThrow('No such mempool or blockchain transaction');
  });
});

describe('validateEsploraOutspends', () => {
  test('accepts a mempool spender and rejects an unstated confirmation', () => {
    const outputs = [{ unspendable: false }];
    expect(outspendSource.validateEsploraOutspends([{ spent: true, txid: SPENDER_A, vin: 0, status: { confirmed: false } }], outputs))
      .toEqual([{ spent: true, txid: SPENDER_A, vin: 0, status: { confirmed: false } }]);
    expect(outspendSource.validateEsploraOutspends([{ spent: true, txid: SPENDER_A, vin: 0, status: {} }], outputs)).toBeNull();
  });
});
