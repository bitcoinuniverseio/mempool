import { EventEmitter } from 'events';
import { streamData } from './data-studio-stream';
import { DataStudioRoutes } from './data-studio.routes';
import { MCP_TOOLS } from './data-studio.service';
import express from 'express';
describe('actual transport contracts', () => {
  it('disconnects a backpressured SSE client and releases its subscription', async () => {
    const req: any = new EventEmitter();
    req.get = () => undefined;
    req.query = {};
    const res: any = new EventEmitter();
    res.setHeader = jest.fn();
    res.flushHeaders = jest.fn();
    res.write = jest.fn(() => false);
    res.writableLength = 0;
    res.destroy = jest.fn();
    res.end = jest.fn();
    const off = jest.fn(),
      service: any = {
        refresh: async () => ({}),
        eventsAfter: () => [{ id: 'cursor', network: 'regtest' }],
        subscribe: () => off,
      };
    await streamData(req, res, service);
    expect(res.destroy).toHaveBeenCalledTimes(1);
    expect(off).toHaveBeenCalledTimes(1);
    req.emit('close');
    expect(off).toHaveBeenCalledTimes(1);
  });
  it('passes resume cursor to persistent coverage validation before starting SSE', async () => {
    const req: any = { get: () => 'foreign:99', query: {} };
    const res: any = { setHeader: jest.fn() };
    const service: any = {
      refresh: async () => ({}),
      eventsAfter: jest.fn(() => {
        throw Error('expired');
      }),
    };
    await expect(streamData(req, res, service)).rejects.toThrow('expired');
    expect(service.eventsAfter).toHaveBeenCalledWith('foreign:99');
    expect(res.setHeader).not.toHaveBeenCalled();
  });
  it('exposes executable MCP tools and rejects remote-origin rebinding without touching data', async () => {
    const service: any = {
      $getCatalog: jest.fn(async () => ({ datasets: [], mcpTools: [] })),
      $executeQuery: jest.fn(async (q) => ({ snapshotId: 'actual-fixture', rows: [[q.limit]] })),
    };
    const app = express();
    app.use(express.json());
    new DataStudioRoutes(service).initRoutes(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    const base = 'http://127.0.0.1:' + (server.address() as any).port + '/api/v1/data/mcp/rpc';
    try {
      const post = (body: any, origin?: string) =>
        fetch(base, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(origin ? { origin } : {}),
          },
          body: JSON.stringify(body),
        });
      const denied = await post(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'data_catalog', arguments: {} } },
        'https://attacker.example'
      );
      expect(denied.status).toBe(403);
      expect(service.$getCatalog).not.toHaveBeenCalled();
      const listed = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
      expect(listed.result.tools.map((t) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
      const called = await (
        await post({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'data_query', arguments: { datasetId: 'bitcoin.blocks', limit: 7 } },
        })
      ).json();
      expect(JSON.parse(called.result.content[0].text).rows).toEqual([[7]]);
      expect(service.$executeQuery).toHaveBeenCalledWith({ datasetId: 'bitcoin.blocks', limit: 7 });
      const notification = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
      expect(notification.status).toBe(202);
      expect(await notification.text()).toBe('');
      const get = await fetch(base);
      expect(get.status).toBe(405);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
