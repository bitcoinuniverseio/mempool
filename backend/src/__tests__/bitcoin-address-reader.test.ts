import http from 'http';
import bitcoinClient, { addressBitcoinClient } from '../api/bitcoin/bitcoin-client';

it('serves address reads while the bulk pool is occupied, using a separate bounded agent', async () => {
  expect(addressBitcoinClient.rpc.agent).not.toBe(bitcoinClient.rpc.agent);
  expect(addressBitcoinClient.rpc.agent.maxSockets).toBe(4);
  const pools = [bitcoinClient.rpc, addressBitcoinClient.rpc];
  const old = pools.map(pool => ({ ...pool.opts }));
  let release!: () => void, observed!: () => void;
  const held = new Promise<void>(resolve => { observed = resolve; });
  const sockets = new Set<any>();
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const call = JSON.parse(body);
      const answer = () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: call.id, result: call.params[0], error: null })); };
      if (call.params[0] === 1) { release = answer; observed(); } else answer();
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  try {
    for (const pool of pools) { Object.assign(pool.opts, { host: '127.0.0.1', port, timeout: 1000, cookie: undefined }); pool.agent.maxSockets = 1; }
    const bulk = bitcoinClient.rpc.call('getblockhash', [1]); await held;
    let bulkReadSettled = false;
    const queued = bitcoinClient.rpc.call('getblockhash', [2]).then(value => { bulkReadSettled = true; return value; });
    expect(await addressBitcoinClient.rpc.call('getblockhash', [3])).toBe(3);
    expect(bulkReadSettled).toBe(false);
    release(); expect(await bulk).toBe(1); expect(await queued).toBe(2);
  } finally {
    pools.forEach((pool, index) => { pool.agent.destroy(); pool.opts = old[index]; pool.agent.maxSockets = index === 0 ? 8 : 4; });
    sockets.forEach(socket => socket.destroy()); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
