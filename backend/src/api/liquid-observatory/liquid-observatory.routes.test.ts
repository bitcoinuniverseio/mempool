import express from 'express';
import { request } from 'http';
import { AddressInfo } from 'net';
import routes from './liquid-observatory.routes';
import { liquidObservatoryService, LiquidObservatoryEvidenceError } from './liquid-observatory.service';
import { elementsNodeSource } from './elements-node-source';

describe('actual mounted Liquid selector/cancellation boundary', () => {
  test('node rejects repeated, nested and foreign selectors before native dispatch and defaults only absence', async () => {
    const app = express(); app.set('query parser', 'extended'); routes.initRoutes(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/v1/liquid/observatory/node';
    const snapshot = jest.spyOn(elementsNodeSource, 'snapshot').mockRejectedValue(new LiquidObservatoryEvidenceError('unavailable', 'Controlled native source unavailable.'));
    try {
      for (const query of ['?network=liquidv1&network=liquidtestnet', '?network[x]=liquidv1', '?network=signet', '?network=']) {
        expect((await fetch(origin + query)).status).toBe(400);
      }
      expect(snapshot).not.toHaveBeenCalled();
      expect((await fetch(origin)).status).toBe(503);
      expect(snapshot).toHaveBeenCalledTimes(1);
      expect(snapshot).toHaveBeenCalledWith('liquidv1');
    } finally { snapshot.mockRestore(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  test('rejects caller origins, noncanonical repeated selectors and oversized pages before producer calls', async () => {
    const app = express(); app.use(express.json()); routes.initRoutes(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/v1/liquid/observatory/';
    const advance = jest.spyOn(liquidObservatoryService, '$advanceProjection');
    try {
      for (const path of ['summary?origin=http://foreign.invalid', 'summary?network=elementsregtest&network=liquidv1', 'assets?limit=101', 'pegs?offset=01']) {
        const response = await fetch(origin + path);
        expect(response.status).toBe(400);
        expect(await response.json()).toHaveProperty('stage');
      }
      const response = await fetch(origin + 'projection/advance', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ height: -1, blockHash: null, origin: 'http://foreign.invalid' }) });
      expect(response.status).toBe(400);
      expect(advance).not.toHaveBeenCalled();
    } finally { advance.mockRestore(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  test('a real client disconnect aborts the actual registered manual acquisition signal', async () => {
    const app = express(); app.use(express.json()); routes.initRoutes(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    let start: () => void, cancelled: () => void, received: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { start = resolve; });
    const aborted = new Promise<void>(resolve => { cancelled = resolve; });
    const advance = jest.spyOn(liquidObservatoryService, '$advanceProjection').mockImplementation(async (_height, _hash, signal) => {
      received = signal; start();
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => {
        cancelled(); reject(new LiquidObservatoryEvidenceError('liquid-source-deadline', 'Actual test client disconnected.', 504));
      }, { once: true }));
    });
    const client = request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port,
      path: '/api/v1/liquid/observatory/projection/advance', method: 'POST', headers: { 'Content-Type': 'application/json' } });
    client.on('error', () => undefined);
    try {
      client.end(JSON.stringify({ height: -1, blockHash: null }));
      await started; client.destroy(); await aborted;
      expect(received!.aborted).toBe(true); expect(advance).toHaveBeenCalledTimes(1);
    } finally { client.destroy(); advance.mockRestore(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
