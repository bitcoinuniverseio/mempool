import { HttpErrorResponse } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ArkDashboardComponent } from './ark-dashboard.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));

describe('Ark dashboard on an absent source', () => {
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
  it('clears prior tables on network change and cancels pending reads on destroy', () => {
    const network = new Subject<string>(); const operators: Subject<any>[] = []; const batches: Subject<any>[] = [];
    const api = {getArkOperators$: () => {const s=new Subject();operators.push(s);return s;}, getArkBatches$: () => {const s=new Subject();batches.push(s);return s;}};
    const view = new ArkDashboardComponent(api as unknown as UniverseApiService, {setTitle:vi.fn()} as unknown as SeoService, {network:'signet',networkChanged$:network} as unknown as StateService);
    view.ngOnInit();let latest:any;view.vm$.subscribe(x=>latest=x);
    operators[0].next({operators:[]});operators[0].complete();batches[0].next({batches:[]});batches[0].complete();expect(latest.kind).toBe('ready');
    network.next('regtest');expect(latest.kind).toBe('loading');expect(latest.operators).toBeUndefined();
    view.ngOnDestroy();expect(operators[1].observed).toBe(false);expect(batches[1].observed).toBe(false);
  });
});
