import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { L2ObservatoryComponent } from './l2-observatory.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));

describe('L2 observatory on an absent source', () => {
  it('shows the error state with the reason rather than empty bridge tables', () => {
    const api = { getL2Systems$: unavailable, getL2Challenges$: unavailable } as unknown as UniverseApiService;
    const view = new L2ObservatoryComponent(api, { setTitle: vi.fn() } as unknown as SeoService);
    view.ngOnInit();
    let observed: any;
    view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
    expect(observed.kind).toBe('error');
    expect(observed.message).toBeTruthy();
    expect(observed.systems).toBeUndefined();
    expect(observed.challenges).toBeUndefined();
  });
});
