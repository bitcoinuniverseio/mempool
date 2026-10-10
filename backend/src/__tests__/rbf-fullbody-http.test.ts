import * as http from 'http';
import { once } from 'events';
import { RbfBodyStore } from '../api/rbf-body-store';
import { RbfSnapshotError } from '../api/rbf-snapshot';
import { defaultMock, isolatedBackend } from '../../test-support/isolated-backend-helper';
const id = 'a'.repeat(64);
describe('complete RBF HTTP body ownership', () => {
  let server: http.Server, store: RbfBodyStore, port: number, routes: any;
  let writesBlocked: number, failures: string[];
  const body = { txid: id, weight: 400, vin: [{ witness: ['x'.repeat(2_000_000)] }], vout: [{ value: 0 }], status: { confirmed: false }, unknown: { kept: true } };
  beforeEach(async () => {
    writesBlocked = 0; failures = []; store = new RbfBodyStore(); store.captureBatch([body], false);
    const state = { unavailable: false, diagnostic: () => ({ schemaVersion: 'universe-rbf-history-availability-v1', status: 'available', reason: null }),
      fail: (reason: string) => { failures.push(reason); } };
    routes = isolatedBackend('api/bitcoin/bitcoin.routes.ts', {
      '../rbf-cache': defaultMock({ hasBody: (key: string) => store.has(key), body: (key: string, signal: AbortSignal) => store.body(key, signal) }),
      '../rbf-snapshot': { rbfRestoreState: state, RbfSnapshotError }, '../../config': defaultMock({ MEMPOOL: {}, FIAT_PRICE: {} }),
    }).default;
    server = http.createServer((req, response) => {
      const res = response as any, request = req as any; request.params = { txId: req.url!.slice(1) };
      res.type = (value: string) => { res.setHeader('content-type', value); return res; };
      res.status = (code: number) => { res.statusCode = code; return res; }; res.json = (value: unknown) => res.end(JSON.stringify(value));
      const write = res.write.bind(res); res.write = (...args: any[]) => { const result = write(...args); if (!result) { writesBlocked++; } return result; };
      void routes.getCachedTx(request, res);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); port = (server.address() as any).port;
  });
  afterEach(async () => { await store.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  it('uses real HTTP backpressure and preserves the complete original DTO without a projection', async () => {
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/' + id }, res => {
        expect(res.statusCode).toBe(200); const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
      }).on('error', reject);
    });
    expect(JSON.parse(bytes.toString())).toEqual(body); expect(writesBlocked).toBeGreaterThan(0);
    expect(store.activeReads).toBe(0); expect(failures).toEqual([]);
  });
  it('caller disconnect exits the actual body owner and does not quarantine history or infer human intent', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port, path: '/' + id }, response => {
        response.once('data', () => { response.destroy(); request.destroy(); resolve(); }); response.on('error', () => undefined);
      }); request.on('error', reject);
    });
    for (let n = 0; n < 100 && store.activeReads; n++) { await new Promise(resolve => setTimeout(resolve, 2)); }
    expect(store.activeReads).toBe(0); expect(failures).toEqual([]);
  });
  it('a held sink is released on close instead of advancing the iterator or leaving listeners/owners stranded', async () => {
    const request = new (require('events').EventEmitter)(); request.params = { txId: id };
    const res = new (require('events').EventEmitter)(); res.headersSent = true; res.destroyed = false; res.type = () => res;
    res.write = jest.fn(() => false); res.end = jest.fn(); res.destroy = jest.fn();
    const running = routes.getCachedTx(request, res);
    for (let n = 0; n < 20 && !res.write.mock.calls.length; n++) { await Promise.resolve(); }
    expect(store.activeReads).toBe(1); expect(res.write).toHaveBeenCalledTimes(1);
    res.destroyed = true; res.emit('close'); await running;
    expect(store.activeReads).toBe(0); expect(res.end).not.toHaveBeenCalled(); expect(failures).toEqual([]);
    expect(res.listenerCount('drain')).toBe(0); expect(res.listenerCount('close')).toBe(0); expect(request.listenerCount('aborted')).toBe(0);
  });
});
