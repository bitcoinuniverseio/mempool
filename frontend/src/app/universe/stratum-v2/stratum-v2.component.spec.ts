import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { StratumV2Component } from './stratum-v2.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));

describe('Stratum V2 observatory on an absent source', () => {
  it('shows the error state with the reason rather than empty role and template tables', () => {
    const api = {
      getStratumV2Network$: unavailable, getStratumV2Templates$: unavailable, getStratumV2Declarations$: unavailable,
    } as unknown as UniverseApiService;
    const view = new StratumV2Component(api, { setTitle: vi.fn() } as unknown as SeoService, {network:'signet',networkChanged$:new Subject()} as any);
    view.ngOnInit();
    let observed: any;
    view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
    expect(observed.kind).toBe('error');
    expect(observed.message).toBeTruthy();
    expect(observed.roles).toBeUndefined();
    expect(observed.templates).toBeUndefined();
    view.ngOnDestroy();
  });

  it('retains rejected declarations and pool modifications without converting acceptance', () => {
    const declaration = {jobId:'job',templateId:'template',declaratorId:'miner',minerDeclaredTxids:['a'],poolModifiedTxids:['b'],acceptedByPool:false,poolRejectionCode:'invalid-job',latencyMs:25};
    const view = new StratumV2Component({getStratumV2Network$:()=>of({roles:[]}),getStratumV2Templates$:()=>of({templates:[]}),getStratumV2Declarations$:()=>of({declarations:[declaration]})} as any, {setTitle:vi.fn()} as any, {network:'signet',networkChanged$:new Subject()} as any);
    let observed:any;view.vm$.subscribe(value=>observed=value);view.ngOnInit();
    expect(observed.declarations).toEqual([declaration]);expect(observed.declarations[0].acceptedByPool).toBe(false);view.ngOnDestroy();
  });

  it('clears old network telemetry and cancels pending reads on network change and destroy', () => {
    const networkChanged$ = new Subject<string>(); const reads:Subject<any>[]=[];
    const view = new StratumV2Component({getStratumV2Network$:()=>of({roles:[]}),getStratumV2Templates$:()=>of({templates:[]}),getStratumV2Declarations$:()=>{const read=new Subject();reads.push(read);return read;}} as any,{setTitle:vi.fn()} as any,{network:'signet',networkChanged$} as any);
    let observed:any;view.vm$.subscribe(value=>observed=value);view.ngOnInit();reads[0].next({declarations:[]});expect(observed.kind).toBe('ready');
    networkChanged$.next('testnet');expect(observed.kind).toBe('loading');expect(observed.declarations).toBeUndefined();expect(reads[0].observed).toBe(false);
    reads[0].next({declarations:[{jobId:'obsolete'}]});expect(observed.kind).toBe('loading');view.ngOnDestroy();expect(reads[1].observed).toBe(false);
  });

  it('reports missing transaction lists as incomplete telemetry', () => {
    const view = new StratumV2Component({getStratumV2Network$:()=>of({roles:[]}),getStratumV2Templates$:()=>of({templates:[]}),getStratumV2Declarations$:()=>of({declarations:[{jobId:'incomplete'}]})} as any,{setTitle:vi.fn()} as any,{network:'signet',networkChanged$:new Subject()} as any);
    let observed:any;view.vm$.subscribe(value=>observed=value);view.ngOnInit();expect(observed.kind).toBe('error');view.ngOnDestroy();
  });
});
