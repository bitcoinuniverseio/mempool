import http from 'http';
import { rpcPoolLimits } from '../rpc-api/pool-limits';

describe('owned node existing RPC pool configuration', () => {
  afterEach(() => { jest.dontMock('../config'); jest.dontMock('../../mempool-config.json'); });

  it('retains omitted-field defaults and rejects unsafe explicit limits', () => {
    expect(rpcPoolLimits({})).toEqual({ bulk: 8, address: 4 });
    expect(rpcPoolLimits({ MAX_SOCKETS: 1, ADDRESS_MAX_SOCKETS: 1 })).toEqual({ bulk: 1, address: 1 });
    for (const value of [0, -1, 1.5, NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => rpcPoolLimits({ MAX_SOCKETS: value as number })).toThrow('CORE_RPC.MAX_SOCKETS');
      expect(() => rpcPoolLimits({ ADDRESS_MAX_SOCKETS: value as number })).toThrow('CORE_RPC.ADDRESS_MAX_SOCKETS');
    }
    expect(() => rpcPoolLimits({ MAX_SOCKETS: 9 })).toThrow('between 1 and 8');
    expect(() => rpcPoolLimits({ ADDRESS_MAX_SOCKETS: 5 })).toThrow('between 1 and 4');
  });

  it('rejects invalid settings at configuration loading before any client is created', () => {
    jest.isolateModules(() => {
      jest.doMock('../../mempool-config.json', () => ({ CORE_RPC: { ADDRESS_MAX_SOCKETS: 0 } }), { virtual: true });
      expect(() => jest.requireActual('../config')).toThrow('CORE_RPC.ADDRESS_MAX_SOCKETS');
    });
  });

  it('admits at most two Signet sockets with one reserved interactive slot and cancels queued bulk reads', async () => {
    const sockets = new Set<import('net').Socket>();
    const requests: string[] = [];
    let maxConnected = 0, active = 0, maxActive = 0;
    let release!: () => void, observed!: () => void;
    const held = new Promise<void>(resolve => { observed = resolve; });
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const call = JSON.parse(body); const name = call.params[0]; requests.push(name);
        active++; maxActive = Math.max(maxActive, active);
        let complete = false;
        const finish = (): void => { if (!complete) { complete = true; active--; } };
        res.once('finish', finish); res.once('close', finish);
        const answer = (): void => { res.end(JSON.stringify({ id: call.id, result: name, error: null })); };
        if (name === 'held-bulk') { release = answer; observed(); } else answer();
      });
    });
    server.on('connection', socket => {
      sockets.add(socket); maxConnected = Math.max(maxConnected, sockets.size);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as import('net').AddressInfo).port;
    let bulkClient, addressClient, secondClient;
    jest.isolateModules(() => {
      jest.doMock('../config', () => ({ __esModule: true, default: {
        MEMPOOL: { NETWORK: 'signet', USE_SECOND_NODE_FOR_MINFEE: false, LIMIT_GBT: false },
        CORE_RPC: { HOST: '127.0.0.1', PORT: port, COOKIE: false, TIMEOUT: 2000, MAX_SOCKETS: 1, ADDRESS_MAX_SOCKETS: 1 },
        SECOND_CORE_RPC: { HOST: '127.0.0.1', PORT: port, COOKIE: false, TIMEOUT: 2000 },
      } }));
      const clients = require('../api/bitcoin/bitcoin-client');
      bulkClient = clients.default; addressClient = clients.addressBitcoinClient;
      secondClient = require('../api/bitcoin/bitcoin-second-client').default;
    });
    try {
      expect(bulkClient.rpc.agent).not.toBe(addressClient.rpc.agent);
      expect([bulkClient.rpc.agent.maxSockets, addressClient.rpc.agent.maxSockets]).toEqual([1, 1]);
      expect(bulkClient.rpc.opts.host).toBe(addressClient.rpc.opts.host);
      expect(bulkClient.rpc.opts.port).toBe(addressClient.rpc.opts.port);
      expect(bulkClient.rpc.opts.cookie).toBe(addressClient.rpc.opts.cookie);
      const bulk = bulkClient.rpc.call('getblockhash', ['held-bulk']); await held;
      const controller = new AbortController();
      const cancelled = bulkClient.rpc.call('getblockhash', ['cancelled-queue'], { signal: controller.signal })
        .then(() => 'unexpected-success', error => error.code);
      let nextBulkSettled = false;
      const nextBulk = bulkClient.rpc.call('getblockhash', ['next-bulk']).then(value => { nextBulkSettled = true; return value; });
      expect(await addressClient.rpc.call('getblockhash', ['address-now'])).toBe('address-now');
      expect(nextBulkSettled).toBe(false);
      controller.abort(); expect(await cancelled).toBe('EABORTED');
      release(); expect(await bulk).toBe('held-bulk'); expect(await nextBulk).toBe('next-bulk');
      expect(requests).toEqual(['held-bulk', 'address-now', 'next-bulk']);
      expect(maxActive).toBeLessThanOrEqual(2); expect(maxConnected).toBeLessThanOrEqual(2);
      // Constructing the disabled second reader has no transport side effect.
      expect(Object.keys(secondClient.rpc.agent.sockets)).toHaveLength(0);
      expect(Object.keys(secondClient.rpc.agent.freeSockets)).toHaveLength(0);
    } finally {
      for (const client of [bulkClient, addressClient, secondClient]) client?.rpc.agent.destroy();
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
