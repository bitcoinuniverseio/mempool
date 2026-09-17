import { describe, it, expect, vi, afterEach } from 'vitest';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { BootstrapApiService } from './bootstrap.service';
import { BootstrapChainstatesComponent } from './bootstrap-chainstates.component';
import { BootstrapOverviewComponent } from './bootstrap-overview.component';

afterEach(() => vi.useRealTimers());
describe('Bootstrap overview subfeature statuses', () => {
  it('renders each subfeature status with the reason the backend gave', () => {
    const component = new BootstrapOverviewComponent({} as any, { markForCheck: vi.fn() } as any);
    const rows = component.subfeatures({
      snapshot_catalogue_status: 'unavailable', snapshot_catalogue_reason: 'No catalogue file is configured.',
      verification_store_status: 'unavailable', verification_store_reason: 'Verification runs need the durable MySQL store (DATABASE.ENABLED).',
      planning_status: 'unavailable', operator_status: 'available', operator_reason: null,
    } as any);
    expect(rows.map(r => [r.label, r.status])).toEqual([
      ['Snapshot catalogue', 'unavailable'], ['Verification store', 'unavailable'], ['Planning', 'unavailable'], ['Operator jobs', 'available'],
    ]);
    expect(rows[0].reason).toContain('catalogue');
    expect(rows[1].reason).toContain('MySQL');
    expect(rows[2].reason).toContain('verification store');
    expect(rows[3].reason).toBeNull();
    expect(component.subfeatures({} as any).every(r => r.status === 'unavailable')).toBe(true);
  });
});
describe('Bootstrap owned observation lifecycle', () => {
  it('uses selected network for every API operation', () => {
    const http = { get: vi.fn(() => of([])), post: vi.fn(() => of({})) };
    const state = {isBrowser:true,network:'signet',env:{ROOT_NETWORK:'mainnet'}};
    const api = new BootstrapApiService(http as any, state as any);
    api.getOverview$();
    expect(http.get.mock.calls[0][0]).toContain('/signet/api/');
    state.network='regtest';api.getNodeChainstates$();
    expect(http.get.mock.calls[1][0]).toContain('/regtest/api/');
  });
  it.each(['chainstates','overview'])('clears stale %s on network change, failure and destruction', async kind => {
    vi.useFakeTimers();
    const network=new BehaviorSubject('signet'), first=new Subject<any>(), second=new Subject<any>();
    const read=vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const api={networkChanged$:network,getNodeChainstates$:read,getOverview$:read};
    const component = kind==='chainstates' ? new BootstrapChainstatesComponent(api as any,{markForCheck:vi.fn()} as any) : new BootstrapOverviewComponent(api as any,{markForCheck:vi.fn()} as any);
    const value=()=>kind==='chainstates'?(component as BootstrapChainstatesComponent).nodes:(component as BootstrapOverviewComponent).overview;
    component.ngOnInit();await vi.advanceTimersByTimeAsync(1);
    first.next(kind==='chainstates'?[{node_id:'old'}]:{configured_nodes_count:1});
    expect(value()).toBeTruthy();
    network.next('regtest');expect(value()).toEqual(kind==='chainstates'?[]:null);
    first.next(kind==='chainstates'?[{node_id:'stale'}]:{configured_nodes_count:9});
    expect(value()).toEqual(kind==='chainstates'?[]:null);
    await vi.advanceTimersByTimeAsync(1);second.error({error:{error:'Owned source offline'}});
    expect(component.error).toBe('Owned source offline');
    component.ngOnDestroy();const calls=read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);expect(read.mock.calls.length).toBe(calls);
  });
});
