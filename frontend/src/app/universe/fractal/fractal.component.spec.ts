import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError, BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { Cat20CenterComponent } from './cat20-center.component';
import { FractalDashboardComponent } from './fractal-dashboard.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));
const selectedNetwork$ = () => of('signet');
const seo = { setTitle: vi.fn() } as unknown as SeoService;

function observe<T>(view: { ngOnInit(): void; vm$: { subscribe(next: (value: T) => void): { unsubscribe(): void } } }): T {
  view.ngOnInit();
  let observed!: T;
  view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
  return observed;
}

describe('Fractal pages on an absent source', () => {
  it('shows the dashboard error state with the reason when the node read fails', () => {
    const api = { selectedNetwork$, getFractalTip$: unavailable, getFractalMempool$: unavailable, getFractalBlock$: unavailable } as unknown as UniverseApiService;
    const vm = observe<any>(new FractalDashboardComponent(api, seo));
    expect(vm.kind).toBe('error');
    expect(vm.message).toBeTruthy();
    expect(vm.tip).toBeUndefined();
  });

  it('reads the latest block at the reported tip rather than a fixed height', () => {
    const getFractalBlock$ = vi.fn(() => of({ height: 12, hash: 'h' }));
    const api = {
      selectedNetwork$,
      getFractalTip$: () => of({ height: 12, hash: 'h', time: 0, network: 'fractal-mainnet' }),
      getFractalMempool$: () => of({ count: 0 }),
      getFractalBlock$,
    } as unknown as UniverseApiService;
    const vm = observe<any>(new FractalDashboardComponent(api, seo));
    expect(vm.kind).toBe('ready');
    expect(getFractalBlock$).toHaveBeenCalledWith('h');
  });

  it('shows the CAT-20 error state rather than an empty directory when the indexer read fails', () => {
    const api = { selectedNetwork$, getCat20Tokens$: unavailable } as unknown as UniverseApiService;
    const route = { paramMap: of(convertToParamMap({})) } as unknown as ActivatedRoute;
    const vm = observe<any>(new Cat20CenterComponent(api, route, seo));
    expect(vm.kind).toBe('error');
    expect(vm.message).toBeTruthy();
    expect(vm.tokens).toBeUndefined();
  });

  it('does not show a token over an empty holder table when only the holder read fails', () => {
    const api = {
      selectedNetwork$,
      getCat20Token$: () => of({ tokenId: 'token-1', holderCount: 3 }),
      getCat20Holders$: unavailable,
    } as unknown as UniverseApiService;
    const route = { paramMap: of(convertToParamMap({ tokenId: 'token-1' })) } as unknown as ActivatedRoute;
    const vm = observe<any>(new Cat20CenterComponent(api, route, seo));
    expect(vm.kind).toBe('detail');
    expect(vm.holderFailure).toBeTruthy();expect(vm.holders).toBeUndefined();
  });
});


describe('Fractal partial native observations', () => {
  it('retains an observed tip and block when mempool reading fails', () => {
    const api = {selectedNetwork$,getFractalTip$:()=>of({height:12,hash:'a'.repeat(64),network:'fractal-testnet',observation:{ready:false}}),getFractalMempool$:unavailable,getFractalBlock$:()=>of({height:12,hash:'a'.repeat(64)})} as unknown as UniverseApiService;
    const vm=observe<any>(new FractalDashboardComponent(api,seo));
    expect(vm.kind).toBe('ready');expect(vm.tip.height).toBe(12);expect(vm.mempoolFailure).toBeTruthy();expect(vm.mempool).toBeUndefined();
  });
  it('retains observed token facts when holder projection is unavailable', () => {
    const api={selectedNetwork$,getCat20Token$:()=>of({tokenId:'token-1',holderCount:3}),getCat20Holders$:unavailable} as unknown as UniverseApiService;
    const route={paramMap:of(convertToParamMap({tokenId:'token-1'}))} as unknown as ActivatedRoute;
    const vm=observe<any>(new Cat20CenterComponent(api,route,seo));
    expect(vm.kind).toBe('detail');expect(vm.selected.tokenId).toBe('token-1');expect(vm.holderFailure).toBeTruthy();expect(vm.holders).toBeUndefined();
  });
});

const token=(id:string):any=>({schema:'cat20-token-v1',tokenId:id,name:'Token',symbol:'T',decimals:8,maxSupplyAtomic:null,circulatingSupplyAtomic:'9007199254740993',mintLimitAtomic:null,deployTxid:'a'.repeat(64),deployHeight:10,minterAddress:null,minterPubKey:'b'.repeat(64),minterType:null,holderCount:0,transferCount:null,state:null,unavailable:['maxSupply']});
const page=(items:any[],total:number,nextCursor:string|null):any=>({schema:'cat20-page-v1',items,total,nextCursor,checkpoint:{height:10,hash:'a'.repeat(64)},trackerSourceRevision:'8d5aeee7484bacc33d0014b44503c0b59d39aaff',observation:{source:{configurationSha256:'c'.repeat(64)}}});
function latest(view:any):any {let vm:any;view.vm$.subscribe(value=>vm=value).unsubscribe();return vm;}
describe('Fractal context, retry and manual page lifecycle',()=>{
 it('cancels a pending tip on context change and destroy, then recovers a failed read',()=>{
  const context=new BehaviorSubject('signet'), first=new Subject<any>(), second=new Subject<any>();let calls=0;
  const api={selectedNetwork$:()=>context,getFractalTip$:()=>++calls===1?first:second,getFractalMempool$:unavailable,getFractalBlock$:unavailable} as any;
  const view=new FractalDashboardComponent(api,seo);view.ngOnInit();expect(first.observed).toBe(true);
  context.next('mainnet');expect(first.observed).toBe(false);second.error(new Error('source failure'));expect(latest(view).kind).toBe('error');
  api.getFractalTip$=()=>of({height:12,hash:'a'.repeat(64)});view.retry();expect(latest(view).tip.height).toBe(12);
  api.getFractalTip$=()=>first;view.retry();expect(first.observed).toBe(true);view.ngOnDestroy();expect(first.observed).toBe(false);
 });
 it('guards double continuation, retains rows on error, retries same opaque cursor and cancels on route change',()=>{
  const route=new BehaviorSubject(convertToParamMap({})), pending=new Subject<any>(), get=vi.fn((request:any)=>request.cursor?pending:of(page([token('a')],2,'opaque')));
  const api={selectedNetwork$,getCat20Tokens$:get,getCat20Token$:unavailable,getCat20Holders$:unavailable} as any;
  const view=new Cat20CenterComponent(api,{paramMap:route} as any,seo);view.ngOnInit();view.more();view.more();expect(get).toHaveBeenCalledTimes(2);
  pending.error(new Error('late failure'));expect(latest(view).tokens.length).toBe(1);expect(latest(view).pageFailure).toBe('late failure');
  const retry=new Subject<any>();get.mockImplementation((request:any)=>request.cursor?retry:of(page([token('a')],2,'opaque')));view.more();expect(get).toHaveBeenLastCalledWith({limit:50,cursor:'opaque'});
  route.next(convertToParamMap({tokenId:'b'}));expect(retry.observed).toBe(false);expect(latest(view).tokens).toBeUndefined();view.ngOnDestroy();
 });
 it('rejects duplicate/no-progress pages and requires restart after HTTP409',()=>{
  const get=vi.fn((request:any)=>request.cursor?of(page([token('a')],2,'next')):of(page([token('a')],2,'opaque')));
  const view=new Cat20CenterComponent({selectedNetwork$,getCat20Tokens$:get} as any,{paramMap:of(convertToParamMap({}))} as any,seo);view.ngOnInit();view.more();expect(latest(view).tokens.length).toBe(1);expect(latest(view).pageFailure).toContain('progress');
  get.mockImplementation(()=>throwError(()=>new HttpErrorResponse({status:409})));view.more();expect(latest(view).restartRequired).toBe(true);const calls=get.mock.calls.length;view.more();expect(get).toHaveBeenCalledTimes(calls);
 });
 it('recovers initial directory503 through explicit restart and reaches an exact complete page',()=>{
  const get=vi.fn().mockReturnValueOnce(unavailable()).mockReturnValue(of(page([],0,null)));
  const view=new Cat20CenterComponent({selectedNetwork$,getCat20Tokens$:get} as any,{paramMap:of(convertToParamMap({}))} as any,seo);view.ngOnInit();expect(latest(view).kind).toBe('error');view.restart();expect(latest(view).kind).toBe('ready');expect(latest(view).page.total).toBe(0);view.ngOnDestroy();
 });
});
