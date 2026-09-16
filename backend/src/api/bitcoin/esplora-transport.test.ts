jest.mock('./bitcoin-api-factory', () => ({ bitcoinCoreApi: {} }));

import http from 'http';
import config from '../../config';
import { FailoverRouter } from './esplora-api';

describe('owned Esplora transport boundaries', () => {
  const original = { ...config.ESPLORA };
  const servers: http.Server[] = [];
  async function listen(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  function configure(origin: string): void {
    config.ESPLORA.REST_API_URL = origin;
    config.ESPLORA.UNIX_SOCKET_PATH = null;
    config.ESPLORA.FALLBACK = [];
  }
  afterEach(async () => {
    Object.assign(config.ESPLORA, original);
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  });

  it('refuses unowned primary and fallback origins before a request', () => {
    configure('https://public-index.example.org');
    expect(() => new FailoverRouter()).toThrow('operated loopback');
    configure('http://127.0.0.1:5000'); config.ESPLORA.FALLBACK = ['https://public-index.example.org'];
    expect(() => new FailoverRouter()).toThrow('operated loopback');
  });

  it('does not follow redirects from either data or metadata requests', async () => {
    let redirected = 0;
    const target = await listen((_req,res) => { redirected++; res.end('external substitute'); });
    const source = await listen((_req,res) => { res.writeHead(302, { Location: target }); res.end(); });
    configure(source); const router = new FailoverRouter();
    await expect(router.$get('/tx/example')).rejects.toMatchObject({ response: { status: 302 } });
    await (router as any).$updateFrontendGitHash(router.activeHost);
    await (router as any).$updateHybridGitHash(router.activeHost);
    expect(redirected).toBe(0);
  });

  it('retains configured scheme and port for metadata and ignores proxy environment', async () => {
    const observed: string[] = []; let proxyHits = 0;
    const proxy = await listen((_req,res) => { proxyHits++; res.end('proxy'); });
    const source = await listen((req,res) => {
      observed.push(req.url!); res.setHeader('Content-Type', 'application/json');
      res.end(req.url!.endsWith('.js') ? 'window.__env.GIT_COMMIT_HASH = "candidate";' : '{"height":1}');
    });
    configure(source); const oldProxy=process.env.HTTP_PROXY, oldNoProxy=process.env.NO_PROXY;
    process.env.HTTP_PROXY=proxy; process.env.NO_PROXY='';
    try {
      const router=new FailoverRouter();
      expect(router.activeHost.publicDomain).toBe(source);
      expect(await router.$get('/test')).toEqual({height:1});
      await (router as any).$updateFrontendGitHash(router.activeHost);
      await (router as any).$updateBackendVersions(router.activeHost);
      await (router as any).$updateSSRGitHash(router.activeHost);
      expect(observed).toEqual(['/test','/resources/config.js','/api/v1/backend-info','/ssr/api/status']);
      expect(proxyHits).toBe(0);
      expect(router.activeHost.hashes.frontend).toBe('candidate');
    } finally {
      if (oldProxy===undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY=oldProxy;
      if (oldNoProxy===undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY=oldNoProxy;
    }
  });
});
