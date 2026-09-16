import { describe, it, expect, vi, afterEach } from 'vitest';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { BootstrapApiService } from './bootstrap.service';
import { BootstrapChainstatesComponent } from './bootstrap-chainstates.component';
import { BootstrapOverviewComponent } from './bootstrap-overview.component';

afterEach(() => vi.useRealTimers());
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
