import http from 'http';
import { isolatedBackend } from '../../test-support/isolated-backend-helper';
const { Client } = require('../rpc-api');

it('omits absent fee defaults on the actual RPC wire and preserves zero and burn-only named parameters', async () => {
  const requests: any[] = [];
  const server = http.createServer((req, res) => {
    let bytes = ''; req.on('data', chunk => bytes += chunk);
    req.on('end', () => { const body = JSON.parse(bytes); requests.push(body); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ id: body.id, result: body.method === 'testmempoolaccept' ? [] : { package_msg: 'controlled' }, error: null })); });
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const client = new Client({host:'127.0.0.1',port:(server.address() as any).port,timeout:1000});
  const Api = isolatedBackend('api/bitcoin/bitcoin-api.ts',{}).default, api = new Api(client);
  try {
    await api.$testMempoolAccept(['00']); expect(requests.at(-1).params).toEqual([['00']]);
    await api.$testMempoolAccept(['00'],0); expect(requests.at(-1).params).toEqual([['00'],0]);
    await api.$submitPackage(['00']); expect(requests.at(-1).params).toEqual([['00']]);
    await api.$submitPackage(['00'],0); expect(requests.at(-1).params).toEqual([['00'],0]);
    await api.$submitPackage(['00'],undefined,0); expect(requests.at(-1).params).toEqual({package:['00'],maxburnamount:0});
    await api.$submitPackage(['00'],0,0); expect(requests.at(-1).params).toEqual({package:['00'],maxfeerate:0,maxburnamount:0});
    const count=requests.length; expect(await api.$testMempoolAccept([])).toEqual([]); expect(requests).toHaveLength(count);
  } finally { client.rpc.agent.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
