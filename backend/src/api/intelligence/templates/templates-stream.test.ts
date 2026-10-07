jest.mock('../../bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));
jest.mock('../../mempool-blocks', () => ({ __esModule: true, default: { getMempoolBlocksWithTransactions: () => [] } }));
import express from 'express';
import http from 'http';
import templatesRoutes from './templates.routes';
import { templateCollectorService } from './template-collector.service';

describe('actual Express template stream', () => {
  it('selects literal SSE route, emits collected templates and replays after a cursor', async () => {
    templateCollectorService.resetForTests();
    templateCollectorService.fetchCoreTemplate = async () => ({ height: 100, previousblockhash: 'a'.repeat(64), transactions: [], coinbasevalue: 5000 });
    const app = express(); templatesRoutes.initRoutes(app);
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const requests: http.ClientRequest[] = [];
    const open = (cursor?: string) => new Promise<{ response: http.IncomingMessage; event: Promise<string> }>((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port, path: '/api/v1/intelligence/templates/stream', headers: cursor ? { 'Last-Event-ID': cursor } : {} }, response => {
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('text/event-stream');
        const event = new Promise<string>((done, fail) => {
          let body = '';
          const timer = setTimeout(() => fail(new Error('Actual SSE template timeout')), 3000);
          response.on('data', chunk => { body += chunk.toString(); if (body.includes('event: intelligence.template.observed') && body.endsWith('\n\n')) { clearTimeout(timer); done(body); } });
          response.on('error', error => { clearTimeout(timer); fail(error); });
        });
        resolve({ response, event });
      });
      requests.push(request); request.on('error', reject);
    });
    try {
      const live = await open();
      await templateCollectorService.collectCoreTemplate(1000);
      const first = await live.event;
      const cursor = first.match(/^id: (.+)$/m)![1];
      live.response.destroy();
      await templateCollectorService.collectCoreTemplate(2000);
      const replay = await open(cursor);
      const replayed = await replay.event;
      expect(replayed).toContain('tmpl-core-100-2000');
      expect(replayed).not.toContain(`id: ${cursor}\n`);
      replay.response.destroy();
      const unknown = await new Promise<number>(resolve => http.get(`http://127.0.0.1:${port}/api/v1/intelligence/templates/unknown`, response => { response.resume(); resolve(response.statusCode!); }));
      expect(unknown).toBe(404);
    } finally {
      for (const request of requests) request.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
