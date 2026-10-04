import { HttpErrorResponse } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ArkDashboardComponent } from './ark-dashboard.component';
import { batchPage, nativeBatch, nativeSource } from './ark-native-test-fixtures';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));

describe('Ark dashboard on an absent source', () => {
  it('keeps the whole-page error when the only successful directory contains no provider facts', () => {
    const view = new ArkDashboardComponent({getArkOperators$:()=>of({operators:[]}),getArkBatches$:unavailable} as unknown as UniverseApiService,
      {setTitle:vi.fn()} as unknown as SeoService,{network:'signet',networkChanged$:new Subject()} as unknown as StateService);
    view.ngOnInit();let observed:any;view.vm$.subscribe(value=>observed=value).unsubscribe();
    expect(observed.kind).toBe('error');expect(observed.message).toBeTruthy();expect(observed.operators).toBeUndefined();
  });
  it('shows the error state with the reason rather than empty operator and batch tables', () => {
    const getArkVtxo$ = vi.fn(unavailable);
    const api = { getArkOperators$: unavailable, getArkBatches$: unavailable, getArkVtxo$ } as unknown as UniverseApiService;
    const view = new ArkDashboardComponent(api, { setTitle: vi.fn() } as unknown as SeoService, { network: '', networkChanged$: new Subject() } as unknown as StateService);
    view.ngOnInit();
    let observed: any;
    view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
    expect(observed.kind).toBe('error');
    expect(observed.message).toBeTruthy();
    expect(observed.operators).toBeUndefined();
    expect(observed.batches).toBeUndefined();
    // No VTXO is looked up by an invented ID any more.
    expect(getArkVtxo$).not.toHaveBeenCalled();
  });
});

describe('Ark dashboard request ownership', () => {
  it('keeps operator-only evidence separate and clears it while the next context owns pending independent reads', () => {
    const network = new Subject<string>(); const operators: Subject<any>[] = []; const batches: Subject<any>[] = [];
    const api = {getArkOperators$: () => {const s=new Subject();operators.push(s);return s;}, getArkBatches$: () => {const s=new Subject();batches.push(s);return s;}};
    const view = new ArkDashboardComponent(api as unknown as UniverseApiService, {setTitle:vi.fn()} as unknown as SeoService, {network:'signet',networkChanged$:network} as unknown as StateService);
    view.ngOnInit();let latest:any;view.vm$.subscribe(value=>latest=value);
    operators[0].next({operators:[{id:'observed-provider'}]});operators[0].complete();
    batches[0].error({status:503,error:{error:'Batch projection unavailable'}});
    expect(latest.kind).toBe('ready');expect(latest.operators[0].id).toBe('observed-provider');
    expect(latest.batches).toBeUndefined();expect(latest.batchFailure).toBe('Batch projection unavailable');
    network.next('testnet4');expect(latest.kind).toBe('loading');expect(latest.operators).toBeUndefined();expect(latest.batchFailure).toBeUndefined();
    network.next('signet');expect(operators[1].observed).toBe(false);expect(batches[1].observed).toBe(false);
    view.ngOnDestroy();expect(operators[2].observed).toBe(false);expect(batches[2].observed).toBe(false);
  });
  it('clears prior tables on network change and cancels pending reads on destroy', () => {
    const network = new Subject<string>(); const operators: Subject<any>[] = []; const batches: Subject<any>[] = [];
    const api = {getArkOperators$: () => {const s=new Subject();operators.push(s);return s;}, getArkBatches$: () => {const s=new Subject();batches.push(s);return s;}};
    const view = new ArkDashboardComponent(api as unknown as UniverseApiService, {setTitle:vi.fn()} as unknown as SeoService, {network:'signet',networkChanged$:network} as unknown as StateService);
    view.ngOnInit();let latest:any;view.vm$.subscribe(x=>latest=x);
    operators[0].next({operators:[]});operators[0].complete();batches[0].next(batchPage());batches[0].complete();expect(latest.kind).toBe('ready');
    network.next('regtest');expect(latest.kind).toBe('loading');expect(latest.operators).toBeUndefined();
    view.ngOnDestroy();expect(operators[1].observed).toBe(false);expect(batches[1].observed).toBe(false);
  });
});


describe('Ark bounded window and detail ownership', () => {
  const setup = () => {
    const network = new Subject<string>(); const details: Subject<any>[] = [];
    const windows = vi.fn((window) => of({...batchPage([nativeBatch]),page:{...batchPage([nativeBatch]).page,...window}}));
    const view = new ArkDashboardComponent({getArkOperators$:()=>of({operators:[{id:nativeSource.profile.providerId,source:nativeSource}]}),
      getArkBatches$:windows,getArkBatch$:()=>{const pending=new Subject();details.push(pending);return pending;}} as unknown as UniverseApiService,
      {setTitle:vi.fn()} as unknown as SeoService,{network:'',env:{ROOT_NETWORK:'signet'},networkChanged$:network} as unknown as StateService);
    view.ngOnInit(); let latest:any; const subscription=view.vm$.subscribe(value=>latest=value);
    let detail:any;view.detail$.subscribe(value=>detail=value);
    return {view,network,details,windows,subscription,latest:()=>latest,detail:()=>detail};
  };
  it('rejects an invalid manual window without IO, retries the captured window and cancels detail on refresh', () => {
    const state=setup();expect(state.view.network).toBe('signet');
    state.view.afterSeconds='20';state.view.beforeSeconds='10';state.view.loadWindow();
    expect(state.windows).toHaveBeenCalledTimes(1);expect(state.view.windowError).toBeTruthy();
    state.view.afterSeconds='0';state.view.beforeSeconds='999999999999';state.view.windowLimit=7;state.view.loadWindow();
    expect(state.windows).toHaveBeenLastCalledWith({after:'0',before:'999999999999',limit:7});
    state.view.readDetail(nativeBatch);state.view.readDetail(nativeBatch);expect(state.details).toHaveLength(1);
    state.view.retry();expect(state.details[0].observed).toBe(false);expect(state.detail().kind).toBe('idle');
    expect(state.windows).toHaveBeenLastCalledWith({after:'0',before:'999999999999',limit:7});state.view.ngOnDestroy();
  });
  it('rejects foreign detail and allows retry, then cancels pending detail on selected context change and destroy', () => {
    const state=setup();state.view.readDetail(nativeBatch);
    state.details[0].next({...nativeBatch,anchorTxid:'a'.repeat(64)});expect(state.detail().kind).toBe('error');
    state.view.readDetail(nativeBatch);expect(state.details).toHaveLength(2);
    state.network.next('testnet4');expect(state.details[1].observed).toBe(false);expect(state.detail().kind).toBe('idle');
    state.network.next('signet');state.view.readDetail(nativeBatch);state.view.ngOnDestroy();
    expect(state.details[2].observed).toBe(false);state.details[2].next(nativeBatch);expect(state.detail().kind).toBe('idle');
  });
});
