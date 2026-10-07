import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  API_CACHE_MAX_ENTRIES,
  apiGet,
  NEVER_CACHE_PATHS,
  OFFLINE_URL,
  SHELL_URLS,
  SNAPSHOT_HEADER,
  isApiPath,
  isNeverCachePath,
  isStaticAsset,
  snapshotOf,
  snapshotResponse,
  strategyFor,
  trimApiCache,
} from '../../../universe-service-worker.js';

/**
 * The service worker's decisions, tested the way the worker itself is read:
 * as answers about what is stored and what never can be.
 */

function getRequest(url: string, init: RequestInit = {}): Request {
  return new Request(`https://explorer.example${url}`, init);
}

function urlOf(path: string): URL {
  return new URL(`https://explorer.example${path}`);
}

describe('API storage directives and native freshness',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  function storage(cached?:Response){const cache={put:vi.fn(),delete:vi.fn(async()=>true),keys:vi.fn(async()=>[])};const open=vi.fn(async()=>cache),match=vi.fn(async()=>cached);vi.stubGlobal('caches',{open,match});return{cache,open,match};}
  it('never writes or replays cache for an explicit no-store read, including network failure',async()=>{
    const s=storage(new Response('stale source'));const request=getRequest('/api/v1/stratum-v2/network',{headers:{'Cache-Control':'no-store'}});vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));await expect(apiGet(request)).rejects.toThrow('offline');expect(s.open).not.toHaveBeenCalled();expect(s.match).not.toHaveBeenCalled();expect(s.cache.put).not.toHaveBeenCalled();
  });
  it('returns a genuine no-store response unchanged while evicting the previous eligible entry',async()=>{
    const s=storage(new Response('prior source'));const response=new Response('current source',{headers:{'Cache-Control':'private, no-store'}});vi.stubGlobal('fetch',vi.fn(async()=>response));const request=getRequest('/api/v1/stratum-v2/network');expect(await apiGet(request)).toBe(response);expect(await response.text()).toBe('current source');expect(s.cache.delete).toHaveBeenCalledWith(request);expect(s.cache.put).not.toHaveBeenCalled();
  });
  it('does not replay a legacy incorrectly cached no-store response when offline',async()=>{
    const s=storage(new Response('old protected source',{headers:{'Cache-Control':'no-store'}}));vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));const response=await apiGet(getRequest('/api/v1/stratum-v2/network'));expect(response.type).toBe('error');expect(s.cache.delete).toHaveBeenCalledTimes(1);expect(s.cache.put).not.toHaveBeenCalled();
  });
  it('preserves ordinary allowed snapshot caching and offline fallback with its capture header',async()=>{
    const s=storage();vi.stubGlobal('fetch',vi.fn(async()=>new Response('public block',{headers:{'Cache-Control':'public, max-age=30'}})));const request=getRequest('/api/v1/blocks');expect(await (await apiGet(request)).text()).toBe('public block');expect(s.cache.put).toHaveBeenCalledTimes(1);const cached=s.cache.put.mock.calls[0][1] as Response;expect(cached.headers.get(SNAPSHOT_HEADER)).toBeTruthy();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));vi.stubGlobal('caches',{open:s.open,match:vi.fn(async()=>cached)});expect(await (await apiGet(request)).text()).toBe('public block');
  });
});

describe('what is never stored', () => {
  it('honors explicit no-store request directives before API or static interception',()=>{
    for(const path of ['/api/v1/stratum-v2/network?network=regtest','/resources/config.js']){
      expect(strategyFor(urlOf(path),getRequest(path,{headers:{'Cache-Control':'max-age=0, NO-STORE'}}))).toBeNull();
      expect(strategyFor(urlOf(path),getRequest(path,{cache:'no-store'}))).toBeNull();
    }
  });
  it('refuses every non GET method', () => {
    const post = strategyFor(urlOf('/api/v1/blocks'), getRequest('/api/v1/blocks', { method: 'POST' }));
    expect(post).toBeNull();
  });

  it('refuses each private surface even as a GET', () => {
    for (const path of NEVER_CACHE_PATHS) {
      const target = path.endsWith('/') ? path : `${path}/overview`;
      expect(isNeverCachePath(urlOf(target))).toBe(true);
      expect(strategyFor(urlOf(target), getRequest(target))).toBeNull();
    }
  });

  it('keeps the operator console and the node console out of storage', () => {
    expect(isNeverCachePath(urlOf('/api/v1/admin/adapter/status'))).toBe(true);
    expect(isNeverCachePath(urlOf('/api/v1/node/rpc'))).toBe(true);
    expect(isNeverCachePath(urlOf('/api/v1/blocks'))).toBe(false);
  });

  it('refuses websocket upgrades', () => {
    const request = new Request('wss://explorer.example/api/v1/ws', {
      headers: { upgrade: 'websocket' },
    });
    expect(strategyFor(urlOf('/api/v1/ws'), request)).toBeNull();
  });
});

describe('which cache a request belongs in', () => {
  it('sends navigations to the network first', () => {
    const request = getRequest('/', { method: 'GET' });
    Object.defineProperty(request, 'mode', { value: 'navigate' });
    expect(strategyFor(urlOf('/'), request)).toBe('network-first');
  });

  it('sends content addressed static files to the cache first', () => {
    expect(strategyFor(urlOf('/main.8f2a1c9e.js'), getRequest('/main.8f2a1c9e.js'))).toBe('cache-first');
    expect(isStaticAsset(urlOf('/resources/favicons/favicon.ico'))).toBe(true);
    expect(isStaticAsset(urlOf('/chunk.1b774a.css'))).toBe(true);
  });

  it('lets deployment configuration follow the network', () => {
    expect(isStaticAsset(urlOf('/config.js'))).toBe(false);
    expect(isStaticAsset(urlOf('/customize.js'))).toBe(false);
    expect(strategyFor(urlOf('/config.js'), getRequest('/config.js'))).toBeNull();
  });

  it('sends API reads to the network first', () => {
    expect(isApiPath(urlOf('/api/v1/fees/recommended'))).toBe(true);
    expect(strategyFor(urlOf('/api/v1/fees/recommended'), getRequest('/api/v1/fees/recommended'))).toBe('network-first');
  });

  it('ignores everything it has no rule for', () => {
    expect(strategyFor(urlOf('/somewhere/else'), getRequest('/somewhere/else'))).toBeNull();
  });
});

describe('captured answers state their age', () => {
  it('stamps the capture time on a stored response without changing its bytes', async () => {
    const original = new Response('{"x":1}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const capturedAt = 1756700000000;
    const stored = await snapshotResponse(original, capturedAt);

    expect(stored.headers.get(SNAPSHOT_HEADER)).toBe(new Date(capturedAt).toISOString());
    expect(await stored.text()).toBe('{"x":1}');
    expect(stored.status).toBe(200);
    expect(await original.text()).toBe('{"x":1}');
  });

  it('reports no age for a response that never says', () => {
    expect(snapshotOf(new Response('ok'))).toBeNull();
  });

  it('reports the age of a response that does', async () => {
    const stored = await snapshotResponse(new Response('ok'), 1756700000000);
    expect(snapshotOf(stored)).toBe(1756700000000);
  });
});

describe('the API cache stays bounded', () => {
  it('drops the least recently used entries past the ceiling', async () => {
    const cache = new Map<string, Response>();
    const fake = {
      keys: async () => [...cache.keys()].map((url) => new Request(url)),
      delete: async (request: Request) => cache.delete(request.url),
      put: async (request: Request, response: Response) => {
        cache.set(request.url, response);
      },
    } as unknown as Cache;

    for (let i = 0; i < API_CACHE_MAX_ENTRIES + 5; i++) {
      await fake.put(getRequest(`/api/v1/page/${i}`), new Response(String(i)));
    }
    await trimApiCache(fake, API_CACHE_MAX_ENTRIES);

    expect(cache.size).toBe(API_CACHE_MAX_ENTRIES);
    expect(cache.has('https://explorer.example/api/v1/page/0')).toBe(false);
    expect(cache.has(`https://explorer.example/api/v1/page/${API_CACHE_MAX_ENTRIES + 4}`)).toBe(true);
  });
});

describe('the shell', () => {
  it('captures the offline document', () => {
    expect(SHELL_URLS).toContain('/');
    expect(SHELL_URLS).toContain(OFFLINE_URL);
  });
});
