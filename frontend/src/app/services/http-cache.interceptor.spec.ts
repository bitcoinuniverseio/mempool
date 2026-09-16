import { describe, expect, it } from 'vitest';
import { TransferState } from '@angular/core';
import { HttpHandler, HttpHeaders, HttpParams, HttpRequest, HttpResponse } from '@angular/common/http';
import { firstValueFrom, of } from 'rxjs';
import { HttpCacheInterceptor } from './http-cache.interceptor';
import { NetworkPrefixInterceptor } from './network-prefix.interceptor';

describe('SSR transfer cache query and network isolation', () => {
  it('never seeds a GET with a POST response and preserves cached response headers', async () => {
    const transfer = new TransferState();
    const server = new HttpCacheInterceptor(transfer, 'server');
    const browser = new HttpCacheInterceptor(transfer, 'browser');
    const absolute = 'http://localhost:8997/signet/api/v1/items';
    const relative = '/signet/api/v1/items';
    await firstValueFrom(server.intercept(new HttpRequest('POST', absolute, { mutation: true }), { handle: () => of(new HttpResponse({ body: 'POST response' })) }));
    let misses = 0;
    const downstream: HttpHandler = { handle: () => { misses++; return of(new HttpResponse({ body: 'GET network' })); } };
    const get = await firstValueFrom(browser.intercept(new HttpRequest('GET', relative), downstream)) as HttpResponse<any>;
    expect(get.body).toBe('GET network');
    expect(misses).toBe(1);
    await firstValueFrom(server.intercept(new HttpRequest('GET', absolute), { handle: () => of(new HttpResponse({ body: 'cached GET', headers: new HttpHeaders({ 'x-source-network': 'signet', 'x-observation': ['one', 'two'] }) })) }));
    const hit = await firstValueFrom(browser.intercept(new HttpRequest('GET', relative), downstream)) as HttpResponse<any>;
    expect(hit.body).toBe('cached GET');
    expect(hit.headers.get('x-source-network')).toBe('signet');
    expect(hit.headers.getAll('x-observation')).toEqual(['one', 'two']);
    expect(misses).toBe(1);
  });
  it('keeps each selected network and query response separate through the registered interceptor order', async () => {
    const transfer = new TransferState();
    const server = new HttpCacheInterceptor(transfer, 'server');
    const browser = new HttpCacheInterceptor(transfer, 'browser');
    const state: any = { network: 'signet', env: { ROOT_NETWORK: 'mainnet', BASE_MODULE: 'mempool', NGINX_PROTOCOL: 'http', NGINX_HOSTNAME: 'localhost', NGINX_PORT: 8997 } };
    const prefix = new NetworkPrefixInterceptor(state);
    const request = (origin: string, page: number, explicit = false) => new HttpRequest('GET', origin + (explicit ? '/' + state.network : '') + '/api/v1/intelligence/items', { params: new HttpParams().set('page', page).set('filter', 'a/b & c') });
    for (const network of ['signet', 'testnet4']) {
      state.network = network;
      for (const page of [1, 2]) {
        const downstream: HttpHandler = { handle: req => of(new HttpResponse({ body: { network, page }, url: req.urlWithParams })) };
        await firstValueFrom(prefix.intercept(request('http://localhost:8997', page), { handle: req => server.intercept(req, downstream) }));
      }
    }
    let misses = 0;
    const uncached: HttpHandler = { handle: () => { misses++; return of(new HttpResponse({ body: 'network request' })); } };
    for (const network of ['testnet4', 'signet']) {
      state.network = network;
      for (const page of [2, 1]) {
        const result = await firstValueFrom(prefix.intercept(request('', page, page === 2), { handle: req => browser.intercept(req, uncached) })) as HttpResponse<any>;
        expect(result.body).toEqual({ network, page });
        expect(result.url).toContain('/' + network + '/api/v1/');
      }
    }
    expect(misses).toBe(0);
    await firstValueFrom(prefix.intercept(request('', 1), { handle: req => browser.intercept(req, uncached) }));
    expect(misses).toBe(1); // Each response is consumed exactly once.
  });
});
