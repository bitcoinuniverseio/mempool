import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataStudioApiService } from './data-studio-api.service';
import { Subject } from 'rxjs';

const state = () => ({ isBrowser: true, network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$: new Subject<string>() });
const snapshotId = 'a'.repeat(64);
const catalog = (network = 'signet', datasetSnapshot = snapshotId) => ({
  snapshotId, source: { network }, datasets: [{ id: 'bitcoin.blocks', network, snapshotId: datasetSnapshot }],
});

describe('Data Studio source bindings', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    ['foreign network', catalog('mainnet')],
    ['mixed dataset snapshot', catalog('signet', 'b'.repeat(64))],
  ])('rejects a %s catalogue before readiness', (_name, value) => {
    const api = new DataStudioApiService({ get: () => of(value) } as any, state() as any);
    const seen: any[] = [];
    api.watchCatalog$().subscribe(row => seen.push(row)).unsubscribe();
    expect(seen.at(-1).kind).toBe('error');
  });
  it('recovers on the next catalogue context read and normalizes the configured root', () => {
    const selected = state();
    const http = { get: vi.fn().mockReturnValueOnce(of(catalog('mainnet'))).mockReturnValueOnce(of(catalog())) };
    const api = new DataStudioApiService(http as any, selected as any), seen: any[] = [];
    const sub = api.watchCatalog$().subscribe(row => seen.push(row));
    expect(seen.at(-1).kind).toBe('error');
    selected.networkChanged$.next('');
    expect(seen.at(-1).kind).toBe('ready'); expect(http.get.mock.calls[1][0]).toBe('/api/v1/data/catalog');
    sub.unsubscribe();
  });
  it.each([
    ['network', { network: 'mainnet' }],
    ['snapshot', { snapshotId: 'b'.repeat(64) }],
    ['dataset', { datasetId: 'bitcoin.mempool' }],
  ])('rejects query %s disagreement with the captured request', (_name, change) => {
    const body = { datasetId: 'bitcoin.blocks', snapshotId };
    const result = { ...body, network: 'signet', ...change };
    const api = new DataStudioApiService({ post: () => of(result) } as any, state() as any);
    let rejected = false, received = false;
    api.query$(body).subscribe({ next: () => received = true, error: () => rejected = true });
    expect(received).toBe(false); expect(rejected).toBe(true);
  });
  it('accepts a matching immutable query and keeps explicit request identity captured', () => {
    const response = new Subject<any>(), body = { datasetId: 'bitcoin.blocks', snapshotId };
    const selected = state(), api = new DataStudioApiService({ post: () => response } as any, selected as any);
    const seen: any[] = [];
    const sub = api.query$(body).subscribe(value => seen.push(value));
    body.snapshotId = 'b'.repeat(64); selected.network = 'mainnet';
    const value = { network: 'signet', datasetId: 'bitcoin.blocks', snapshotId };
    response.next(value); expect(seen).toEqual([value]); sub.unsubscribe();
  });
  it('accepts real snapshot and explicit gap kinds, then closes on manual disconnect', () => {
    let listener: (event: any) => void;
    const close = vi.fn();
    vi.stubGlobal('EventSource', class {
      onopen: any; onerror: any;
      addEventListener(name: string, handler: any) { if (name === 'data.snapshot') listener = handler; }
      close = close;
    });
    const api = new DataStudioApiService({} as any, state() as any), seen: any[] = [];
    const sub = api.stream$().subscribe(value => seen.push(value));
    for (const [index, kind] of ['observation_gap', 'snapshot'].entries()) {
      listener!({ data: JSON.stringify({ id: 'writer:' + (index + 1), sequence: index + 1, network: 'signet', snapshotId, kind }) });
    }
    expect(seen.map(row => row.event.kind)).toEqual(['observation_gap', 'snapshot']);
    sub.unsubscribe(); expect(close).toHaveBeenCalledOnce();
  });
  it('closes and rejects a foreign-network native snapshot event', () => {
    let listener: (event: any) => void;
    const close = vi.fn();
    vi.stubGlobal('EventSource', class {
      onopen: any; onerror: any;
      addEventListener(name: string, handler: any) { if (name === 'data.snapshot') listener = handler; }
      close = close;
    });
    const api = new DataStudioApiService({} as any, state() as any);
    let received = false, rejected = false;
    const sub = api.stream$().subscribe({ next: () => received = true, error: () => rejected = true });
    listener!({ data: JSON.stringify({ id: 'writer:1', sequence: 1, network: 'mainnet', snapshotId, kind: 'snapshot' }) });
    expect(received).toBe(false); expect(rejected).toBe(true); expect(close).toHaveBeenCalledOnce();
    sub.unsubscribe();
  });
});
