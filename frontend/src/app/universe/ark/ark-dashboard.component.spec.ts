import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ArkDashboardComponent } from './ark-dashboard.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));

describe('Ark dashboard on an absent source', () => {
  it('shows the error state with the reason rather than empty operator and batch tables', () => {
    const getArkVtxo$ = vi.fn(unavailable);
    const api = { getArkOperators$: unavailable, getArkBatches$: unavailable, getArkVtxo$ } as unknown as UniverseApiService;
    const view = new ArkDashboardComponent(api, { setTitle: vi.fn() } as unknown as SeoService);
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
