import { describe, expect, it, vi } from 'vitest';
import { Subject, of } from 'rxjs';
import { BlockspaceApiService } from './blockspace.service';
import { BlockspaceOverviewComponent } from './blockspace-overview.component';
import { BlockspaceCompositionComponent } from './blockspace-composition.component';
import { blockspaceValue, blockspaceShare, blockspaceBtc } from './blockspace-format';

describe('blockspace unknown presentation and selected source', () => {
  it('preserves known zero and distinguishes missing/nonfinite values', () => {
    expect(blockspaceValue(null, 'sat/vB')).toBe('Unknown');
    expect(blockspaceValue(0, 'sat/vB')).toBe('0 sat/vB');
    expect(blockspaceShare(null, 100)).toBe('Unknown');
    expect(blockspaceShare(0, 100)).toBe('0.0%');
    expect(blockspaceShare(100, 0)).toBe('Unknown');
    expect(blockspaceBtc(null)).toBe('Unknown');
    expect(blockspaceBtc(1)).toBe('0.00000001 BTC');
  });
  it('uses selected same-origin backend routes and rejects cross-network overview evidence', () => {
    const http = { get: vi.fn(() => of({ network: 'mainnet', taxonomy_classes: [], composition_timeseries: [] })) };
    const state = { network: 'signet', isBrowser: true, env: { ROOT_NETWORK: 'mainnet' }, networkChanged$: new Subject() };
    const api = new BlockspaceApiService(http as any, state as any);
    let failed = false; api.getOverview().subscribe({ error: () => { failed = true; } });
    expect(http.get).toHaveBeenCalledWith('/signet/api/v1/intelligence/blockspace/overview');
    expect(failed).toBe(true);
  });
  it('clears data and cancels old network responses, recovers after error, and closes on destroy', () => {
    const state = { network: 'signet', isBrowser: true, env: { ROOT_NETWORK: 'mainnet' }, networkChanged$: new Subject() };
    const responses: Subject<any>[] = [];
    const http = { get: vi.fn(() => { const response = new Subject<any>(); responses.push(response); return response; }) };
    const api = new BlockspaceApiService(http as any, state as any);
    const view = new BlockspaceOverviewComponent(api, { markForCheck: vi.fn() } as any);
    view.ngOnInit();
    responses[0].next({ network: 'signet', taxonomy_classes: [], composition_timeseries: [], median_feerate_24h: null });
    expect(view.overview?.median_feerate_24h).toBeNull();
    state.network = 'regtest'; state.networkChanged$.next('regtest');
    expect(view.overview).toBeNull(); expect(view.loading).toBe(true);
    responses[0].next({ network: 'signet', taxonomy_classes: [], composition_timeseries: [] });
    expect(view.overview).toBeNull();
    responses[1].error(new Error('unavailable'));
    expect(view.error).toContain('unavailable'); expect(view.overview).toBeNull();
    state.network = 'mainnet'; state.networkChanged$.next('mainnet');
    expect(responses).toHaveLength(3); expect(view.error).toBe('');
    view.ngOnDestroy(); responses[2].next({ network: 'mainnet', taxonomy_classes: [], composition_timeseries: [] });
    expect(view.overview).toBeNull();
  });
  it('clears composition rows when a new scoped load begins', () => {
    const source = new Subject<any>();
    const api = { watch: () => source, getComposition: () => of([]) };
    const view = new BlockspaceCompositionComponent(api as any, { markForCheck: vi.fn() } as any);
    view.ngOnInit(); source.next({ kind: 'ready', data: [{ total_weight: null, total_fee_sats: null }] });
    expect(view.composition).toHaveLength(1);
    source.next({ kind: 'loading' }); expect(view.composition).toEqual([]);
    source.next({ kind: 'error', error: 'unavailable' }); expect(view.loading).toBe(false); expect(view.error).toBe('unavailable');
    view.ngOnDestroy();
  });
});
