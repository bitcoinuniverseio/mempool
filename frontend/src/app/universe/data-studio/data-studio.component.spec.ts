import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection, ɵresolveComponentResources } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { DataStudioApiService } from './data-studio-api.service';
import { DataLiveStreamComponent } from './data-live-stream.component';
import { DataStudioComponent } from './data-studio.component';
const seo: any = { setTitle: vi.fn() },
  state = () => ({
    isBrowser: false,
    network: 'signet',
    env: {
      ROOT_NETWORK: 'mainnet',
      BASE_MODULE: 'mempool',
      NGINX_PROTOCOL: 'http',
      NGINX_HOSTNAME: 'localhost',
      NGINX_PORT: 8999,
    },
    networkChanged$: new Subject<string>(),
  });
const catalog = {
  kind: 'ready',
  snapshotId: 'a'.repeat(64),
  datasets: [
    {
      id: 'bitcoin.blocks',
      snapshotId: 'a'.repeat(64),
      fields: [{ name: 'height', type: 'integer' }],
      supportedFormats: [],
      exports: {},
      rowCount: 32,
      sizeBytes: 123,
    },
  ],
  streams: [],
  mcpTools: [],
  source: { network: 'signet', tipHeight: 10, observedAt: 'now' },
  unsupportedAcceptance: ['Parquet export'],
  unavailable: {},
};
function last(c: any) {
  let value: any;
  c.vm$.subscribe((v) => (value = v));
  return value;
}
describe('actual Data Studio UI', () => {
  it('uses the selected backend and cancels old catalog responses on network changes', () => {
    const s = state(),
      pending: Subject<any>[] = [];
    const http: any = {
      get: vi.fn(() => {
        const p = new Subject();
        pending.push(p);
        return p;
      }),
    };
    const api = new DataStudioApiService(http, s as any),
      values: any[] = [];
    const sub = api.watchCatalog$().subscribe((v) => values.push(v));
    expect(http.get.mock.calls[0][0]).toContain('/signet/api/');
    s.network = 'mainnet';
    s.networkChanged$.next('mainnet');
    pending[0].next({ stale: true });
    expect(values.at(-1).kind).toBe('loading');
    pending[1].error(Error('offline'));
    expect(values.at(-1).kind).toBe('error');
    sub.unsubscribe();
  });
  it('binds queries to the selected immutable snapshot and clears success on edits/failure', () => {
    let response = new Subject<any>();
    const api: any = { watchCatalog$: () => of(catalog), query$: vi.fn(() => response) };
    const c = new DataStudioComponent(api, seo);
    c.ngOnInit();
    expect(api.query$.mock.calls[0][0].snapshotId).toBe(catalog.snapshotId);
    response.next({ rows: [[10]], rowCount: 1 });
    c.queryLimit = 2;
    c.invalidateQuery();
    expect(last(c).queryResult).toBeUndefined();
    response.next({ stale: true });
    expect(last(c).queryResult).toBeUndefined();
    response = new Subject();
    c.runQuery();
    response.error({ error: { error: 'Snapshot expired' } });
    expect(last(c).queryError).toBe('Snapshot expired');
    c.ngOnDestroy();
  });
  it('streams only received events, caps display history and disconnects on backend changes', () => {
    const catalogs = new Subject(),
      events = new Subject<any>();
    const api: any = { watchCatalog$: () => catalogs, stream$: () => events };
    const c = new DataLiveStreamComponent(api, seo);
    c.ngOnInit();
    catalogs.next(catalog);
    c.connect();
    for (let i = 0; i < 25; i++) events.next({ kind: 'event', event: { id: String(i), kind: 'snapshot' } });
    expect(last(c).events.length).toBe(20);
    catalogs.next({ kind: 'loading' });
    events.next({ kind: 'event', event: { id: 'stale' } });
    expect(last(c).events).toEqual([]);
    expect(last(c).connection).toBe('disconnected');
    c.ngOnDestroy();
  });
  it('renders actual counts and unsupported formats without false SQL/Parquet or active-stream claims', async () => {
    await ɵresolveComponentResources((url) =>
      Promise.resolve(readFileSync(resolve('src/app/universe/data-studio', url), 'utf8'))
    );
    const html = await renderApplication(
      (context) =>
        bootstrapApplication(
          DataStudioComponent,
          {
            providers: [
              provideZonelessChangeDetection(),
              provideRouter([]),
              { provide: StateService, useValue: state() },
              { provide: SeoService, useValue: seo },
              {
                provide: DataStudioApiService,
                useValue: {
                  watchCatalog$: () => of(catalog),
                  query$: () =>
                    of({
                      columns: ['height'],
                      rows: [[10]],
                      rowCount: 1,
                      totalAvailable: 32,
                      executionTimeMs: 1,
                      nextOffset: null,
                      snapshotId: catalog.snapshotId,
                      network: 'signet',
                    }),
                  exportUrl: () => '',
                },
              },
            ],
          },
          context
        ),
      { document: '<app-data-studio></app-data-studio>', url: 'http://localhost/', allowedHosts: ['localhost'] }
    );
    expect(html).toContain('32 exact rows');
    expect(html).toContain('Parquet export');
    expect(html).not.toContain('Constrained SQL query grammar');
    expect(html).toContain('123 exact NDJSON bytes');
  });
});
