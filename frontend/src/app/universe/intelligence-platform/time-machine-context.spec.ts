import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplaySubject, Subject, of } from 'rxjs';
import { TimeMachineComponent } from './time-machine.component';
import { IntelligenceApiService } from './intelligence-api.service';
import { networkScopedUrl } from '@app/services/network-prefix.interceptor';

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});

function summary() { return {state_hash:'b'.repeat(64),target_block_height:10,target_timestamp_utc:'2026-10-04T12:00:00Z',nearest_checkpoint_id:'chk-signet-10-'+ 'c'.repeat(12),checkpoint_block_hash:'c'.repeat(64),applied_events_count:0,total_transactions:0,total_vsize:0,total_weight:0,total_fees_sats:0,median_feerate_sats_vb:0,fee_distribution:[],projected_blocks_count:0,coverage_status:'partial',gap_intervals:[]}; }
function coverage() {return {network:'signet',observer_id:'controlled-component-fixture',observing_since_utc:'2026-10-04T12:00:00Z',earliest_recorded_event_utc:null,latest_recorded_event_utc:null,persistence:{enabled:true,pending:false,error:null},observed_through_utc:null,total_events:0,total_checkpoints:1,earliest_checkpoint_height:0,latest_checkpoint_height:0,coverage_gaps:[]};}
async function membershipHash(blockHash: string, txids: string[]) {const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(blockHash+':'+[...txids].sort().join(','))));return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}

function setup() {
  const state: any = { network: '', networkChanged$: new Subject<string>(), env: {ROOT_NETWORK: 'signet', BASE_MODULE: 'mempool'}, isBrowser: true };
  const replay = new Subject<any>();
  const api = { getTimeMachineCoverage$: vi.fn(() => of(coverage())), replayHistory$: vi.fn(() => replay), exportHistory$: vi.fn(() => of({format:'json',state:{state_hash:'a'.repeat(64)},txids:[]})) };
  const page: TimeMachineComponent = new (TimeMachineComponent as any)(api, {markForCheck: () => {}}, state);
  page.ngOnInit();return {page, state, api, replay};
}
describe('Time Machine selected context and target lifecycle', () => {
  it('does not replace retained coverage for the replayed or unchanged canonical context', () => {
    const changed = new ReplaySubject<string>(1); changed.next('');
    const state: any = { network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$: changed };
    const api = { getTimeMachineCoverage$: vi.fn(() => of(coverage())) };
    const page = new (TimeMachineComponent as any)(api, { markForCheck() {} }, state);
    page.ngOnInit(); expect(api.getTimeMachineCoverage$).toHaveBeenCalledTimes(1);
    changed.next(''); expect(api.getTimeMachineCoverage$).toHaveBeenCalledTimes(1); page.ngOnDestroy();
  });
  it('preserves one-satoshi fees and rejects unsafe or absent reported quantities', () => {
    const {page}=setup();expect(page.formatFees(1)).toBe('0.00000001 BTC');expect(page.formatFees(0)).toBe('0 BTC');
    for(const value of [null,undefined,-1,0.5,Number.MAX_SAFE_INTEGER+1])expect(page.formatFees(value)).toBe('Not reported');page.ngOnDestroy();
  });
  it('reports actual weight in exact million weight units without assuming virtual bytes', () => {
    const {page}=setup();expect(page.formatWeight(4000000)).toBe('4 MWU');expect(page.formatWeight(1000000)).toBe('1 MWU');expect(page.formatWeight(1)).toBe('0.000001 MWU');expect(page.formatWeight(null)).toBe('Not reported');page.ngOnDestroy();
  });
  it('clears old state as a replacement replay starts and on failure', () => {
    const {page,replay}=setup(); page.currentState={state_hash:'a'.repeat(64)};page.targetHeight=10;page.runReplay();
    expect(page.currentState).toBeNull(); replay.error(new Error('unavailable'));expect(page.currentState).toBeNull();page.ngOnDestroy();
  });
  it('cancels old replay and reloads coverage when network changes', () => {
    const {page,replay,state,api}=setup();page.targetHeight=10;page.runReplay();state.network='testnet4';state.networkChanged$.next('testnet4');
    replay.next({state_hash:'a'.repeat(64)});expect(page.currentState).toBeNull();expect(page.loading).toBe(false);expect(api.getTimeMachineCoverage$).toHaveBeenCalledTimes(2);page.ngOnDestroy();
  });
  it('allows the genuine height zero target and latest zero checkpoint', () => {
    const {page,api}=setup();page.loadLatestCheckpoint();expect(api.replayHistory$).toHaveBeenCalledWith(undefined,0);page.ngOnDestroy();
  });
  it('rejects competing or noninteger targets before HTTP', () => {
    const {page,api}=setup();page.targetHeight=10;page.targetTimestamp='2026-10-04T12:00:00Z';page.runReplay();expect(api.replayHistory$).not.toHaveBeenCalled();
    page.targetTimestamp='';page.targetHeight=1.5;page.runReplay();expect(api.replayHistory$).not.toHaveBeenCalled();page.ngOnDestroy();
  });
  it('cancels a pending response when target input is edited', () => {
    const {page,replay}=setup();page.targetHeight=10;page.runReplay();expect(typeof (page as any).invalidate).toBe('function');
    (page as any).invalidate();replay.next({state_hash:'a'.repeat(64)});expect(page.currentState).toBeNull();expect(page.loading).toBe(false);page.ngOnDestroy();
  });
  it('publishes only the requested retained height and preserves partial coverage', () => {
    const {page,replay}=setup();page.targetHeight=10;page.runReplay();replay.next({state_hash:'a'.repeat(64),target_block_height:11,coverage_status:'complete'});expect(page.currentState).toBeNull();
    page.runReplay();replay.next(summary());expect(page.currentState.coverage_status).toBe('partial');page.ngOnDestroy();
  });
  it('exports through the selected actual JSON POST contract', () => {
    const {state}=setup();state.network='testnet4';const post=vi.fn(() => of({}));
    const api=new IntelligenceApiService({post:(url: string,body: unknown)=>post(networkScopedUrl(url,state),body)} as any,state,{} as any);
    api.exportHistory$('a'.repeat(64)).subscribe();expect(post).toHaveBeenCalledWith('/testnet4/api/v1/intelligence/history/exports',{state_hash:'a'.repeat(64),format:'json'});
  });
  it('rejects unavailable formats and a foreign export state without a download', () => {
    const {page,api}=setup();page.currentState={state_hash:'b'.repeat(64)};page.exportData('csv');expect(api.exportHistory$).not.toHaveBeenCalled();
    page.exportData('json');expect(page.exportError).toMatch(/does not match/);page.ngOnDestroy();
  });
  it('downloads the hash-bound JSON state and revokes its local object URL', async () => {
    const {page,api}=setup();const click=vi.fn(),link: any={click};vi.stubGlobal('document',{createElement:vi.fn(()=>link)});
    const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:owned-fixture'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    const observed=summary();observed.state_hash=await membershipHash(observed.checkpoint_block_hash,[]);api.exportHistory$.mockReturnValue(of({format:'json',state:observed,txids:[]}));
    page.currentState=observed;page.exportData('json');await vi.waitFor(()=>expect(click).toHaveBeenCalledOnce());expect(api.exportHistory$).toHaveBeenCalledWith(observed.state_hash);expect(link.download).toBe('mempool-state-'+observed.state_hash+'.json');expect(create).toHaveBeenCalledOnce();expect(revoke).toHaveBeenCalledWith('blob:owned-fixture');page.ngOnDestroy();
  });
  it('rejects a same-hash export whose replay target or coverage was replaced', () => {
    const {page,api}=setup();const click=vi.fn();vi.stubGlobal('document',{createElement:()=>({click})});
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:owned-fixture');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    page.currentState={state_hash:'a'.repeat(64),target_block_height:10,coverage_status:'partial',gap_intervals:[{reason:'observed-gap'}]};
    api.exportHistory$.mockReturnValue(of({format:'json',state:{state_hash:'a'.repeat(64),target_block_height:11,coverage_status:'complete',gap_intervals:[]},txids:[]}));
    page.exportData('json');expect(click).not.toHaveBeenCalled();expect(page.exportError).toMatch(/does not match/);page.ngOnDestroy();
  });
  it('rejects impossible UTC calendar dates before HTTP', () => {
    const {page,api}=setup();page.targetTimestamp='2026-02-31T00:00:00Z';page.runReplay();expect(api.replayHistory$).not.toHaveBeenCalled();page.ngOnDestroy();
  });
  it('rejects malformed replay distributions before publishing a rendered state', () => {
    const {page,replay}=setup();page.targetHeight=10;page.runReplay();replay.next({...summary(),fee_distribution:{forged:'not-an-array'}});expect(page.currentState).toBeNull();
    page.runReplay();replay.next({...summary(),fee_distribution:[{feerate_bucket:'1-5 sat/vB',count:-1,total_vsize:0}]});expect(page.currentState).toBeNull();page.ngOnDestroy();
  });
  it('rejects a same-summary export with substituted transaction membership', async () => {
    const {page,api}=setup();const click=vi.fn();vi.stubGlobal('document',{createElement:()=>({click})});vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:owned-fixture');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    const observed={...summary(),total_transactions:1};observed.state_hash=await membershipHash(observed.checkpoint_block_hash,['1'.repeat(64)]);page.currentState=observed;api.exportHistory$.mockReturnValue(of({format:'json',state:observed,txids:['2'.repeat(64)]}));
    page.exportData('json');await vi.waitFor(()=>expect(page.exporting).toBe(false));expect(click).not.toHaveBeenCalled();expect(page.exportError).toMatch(/does not match/);page.ngOnDestroy();
  });
  it('does not download when the network changes during membership hashing', async () => {
    const {page,api,state}=setup();const click=vi.fn();vi.stubGlobal('document',{createElement:()=>({click})});
    const observed=summary();observed.state_hash=await membershipHash(observed.checkpoint_block_hash,[]);page.currentState=observed;api.exportHistory$.mockReturnValue(of({format:'json',state:observed,txids:[]}));
    let finish: (value: ArrayBuffer) => void;vi.spyOn(crypto.subtle,'digest').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    page.exportData('json');expect(page.exporting).toBe(true);state.network='testnet4';state.networkChanged$.next('testnet4');finish(new Uint8Array(32).buffer);await Promise.resolve();
    expect(click).not.toHaveBeenCalled();expect(page.currentState).toBeNull();expect(page.exporting).toBe(false);page.ngOnDestroy();
  });
  it('rejects foreign-network coverage and recovers on a matching native-shaped DTO', () => {
    const {page,api,state}=setup();state.network='testnet4';state.networkChanged$.next('testnet4');expect(page.coverage).toBeNull();expect((page as any).coverageError).toMatch(/selected network/);
    state.network='';state.networkChanged$.next('');
    api.getTimeMachineCoverage$.mockReturnValue(of({...coverage(),network:'testnet4'}));state.network='testnet4';state.networkChanged$.next('testnet4');expect(page.coverage.network).toBe('testnet4');expect((page as any).coverageError).toBeNull();page.ngOnDestroy();
  });
});
