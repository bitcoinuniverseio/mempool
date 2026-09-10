import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
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
    const view = new StratumV2Component(api, { setTitle: vi.fn() } as unknown as SeoService);
    view.ngOnInit();
    let observed: any;
    view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
    expect(observed.kind).toBe('error');
    expect(observed.message).toBeTruthy();
    expect(observed.roles).toBeUndefined();
    expect(observed.templates).toBeUndefined();
  });
});
