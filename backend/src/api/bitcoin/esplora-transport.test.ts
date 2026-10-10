jest.mock('./bitcoin-client', () => {
  const core = {getBlockchainInfo:/** @asyncUnsafe */ async()=>({chain:'signet',blocks:100,bestblockhash:'1'.repeat(64),signet_challenge:'51'}),getBlockHash:/** @asyncUnsafe */ async(height: number)=>height===0?'0'.repeat(64):'1'.repeat(64)};
  return {__esModule:true,default:core,addressBitcoinClient:core};
});

jest.mock('./bitcoin-api-factory', () => ({ bitcoinCoreApi: {} }));

import http from 'http';
import config from '../../config';
import ElectrsApi, { FailoverRouter } from './esplora-api';

describe('owned Esplora transport boundaries', () => {
  const original = { ...config.ESPLORA };
  const servers: http.Server[] = [];
  /** @asyncUnsafe */ async function listen(handler: http.RequestListener): Promise<string> {
    const server = http.createServer(handler); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  function configure(origin: string): void {
    config.ESPLORA.REST_API_URL = origin;
    config.ESPLORA.UNIX_SOCKET_PATH = null;
    config.ESPLORA.FALLBACK = [];
  }
  afterEach(/** @asyncUnsafe */ async () => {
    Object.assign(config.ESPLORA, original);
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  });

  it('refuses unowned primary and fallback origins before a request', () => {
    configure('https://public-index.example.org');
    expect(() => new FailoverRouter()).toThrow('operated loopback');
    configure('http://127.0.0.1:5000'); config.ESPLORA.FALLBACK = ['https://public-index.example.org'];
    expect(() => new FailoverRouter()).toThrow('operated loopback');
  });

  it('does not follow redirects from either data or metadata requests', /** @asyncUnsafe */ async () => {
    let redirected = 0;
    const target = await listen((_req,res) => { redirected++; res.end('external substitute'); });
    const source = await listen((_req,res) => { res.writeHead(302, { Location: target }); res.end(); });
    configure(source); const router = new FailoverRouter();
    await expect(router.$get('/tx/example')).rejects.toMatchObject({ response: { status: 302 } });
    await (router as any).$updateFrontendGitHash(router.activeHost);
    await (router as any).$updateHybridGitHash(router.activeHost);
    expect(redirected).toBe(0);
  });

  it('retains configured scheme and port for metadata and ignores proxy environment', /** @asyncUnsafe */ async () => {
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
  it('validates each selected address host and rejects unsafe provider amounts', /** @asyncUnsafe */ async () => {
    const originalNetwork=config.MEMPOOL.NETWORK; const previousChallenge=process.env.UNIVERSE_SIGNET_CHALLENGE;
    config.MEMPOOL.NETWORK='signet'; process.env.UNIVERSE_SIGNET_CHALLENGE='51';
    let wrongChain=false; let unsafeAmount=false; const seen: string[]=[];
    const origin=await listen((req,res)=>{
      seen.push(req.url!); res.setHeader('Content-Type','application/json');
      if(req.url==='/blocks/tip/height') return res.end('100');
      if(req.url?.startsWith('/block-height/')) return res.end(JSON.stringify(wrongChain?'2'.repeat(64):req.url.endsWith('/0')?'0'.repeat(64):'1'.repeat(64)));
      if(req.url?.includes('/txs/summary')) return res.end(JSON.stringify([{txid:'ab'.repeat(32),height:100,time:0,value:unsafeAmount?Number.MAX_SAFE_INTEGER+1:-1,tx_position:0}]));
      const stats={funded_txo_count:0,funded_txo_sum:unsafeAmount?Number.MAX_SAFE_INTEGER+1:0,spent_txo_count:0,spent_txo_sum:0,tx_count:0};
      res.end(JSON.stringify({address:'test-address',chain_stats:stats,mempool_stats:stats}));
    });
    try{
      configure(origin);const router=new FailoverRouter();
      await expect(router.$get('/address/test-address')).resolves.toMatchObject({address:'test-address'});
      const api=new ElectrsApi();(api as any).failoverRouter=router;
      await expect(api.$getAddressTransactionSummary('test-address','ab'.repeat(32))).resolves.toMatchObject([{value:-1}]);
      await expect(api.$getScriptHashTransactionSummary('cd'.repeat(32),'ab'.repeat(32))).resolves.toMatchObject([{value:-1}]);
      expect(seen).toContain('/address/test-address/txs/summary/'+'ab'.repeat(32)+'?max_txs=5000');
      expect(seen).toContain('/scripthash/'+'cd'.repeat(32)+'/txs/summary/'+'ab'.repeat(32)+'?max_txs=5000');
      expect(seen).toContain('/block-height/0');expect(seen).toContain('/block-height/100');
      unsafeAmount=true;await expect(router.$get('/address/test-address')).rejects.toThrow('invalid numeric');
      await expect(api.$getAddressTransactionSummary('test-address')).rejects.toThrow('invalid numeric');
      wrongChain=true;await expect(router.$get('/address/test-address')).rejects.toThrow('differs');
      router.requestConnection.defaults.httpAgent.destroy();
    }finally{config.MEMPOOL.NETWORK=originalNetwork;if(previousChallenge===undefined)delete process.env.UNIVERSE_SIGNET_CHALLENGE;else process.env.UNIVERSE_SIGNET_CHALLENGE=previousChallenge;}
  });
});
