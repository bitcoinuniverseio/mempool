import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { LiquidObservatoryComponent } from './liquid-observatory.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));

function observe(api: Partial<UniverseApiService>): any {
  const view = new LiquidObservatoryComponent(api as UniverseApiService, { setTitle: vi.fn() } as unknown as SeoService);
  view.ngOnInit();
  let observed: any;
  view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
  return observed;
}

describe('Liquid observatory on an absent source', () => {
  it('shows the error state with the reason when the node read fails', () => {
    const vm = observe({
      getLiquidObservatorySummary$: unavailable, getLiquidAssets$: unavailable,
      getLiquidPegs$: unavailable, getLiquidFederation$: unavailable,
    });
    expect(vm.kind).toBe('error');
    expect(vm.message).toBeTruthy();
    expect(vm.summary).toBeUndefined();
  });

  it('does not show the summary over empty asset and peg tables when only those reads fail', () => {
    const vm = observe({
      getLiquidObservatorySummary$: () => of({ blockHeight: 1 }),
      getLiquidAssets$: unavailable,
      getLiquidPegs$: unavailable,
      getLiquidFederation$: () => of({ epochNumber: 1 }),
    });
    expect(vm.kind).toBe('error');
    expect(vm.assets).toBeUndefined();
    expect(vm.pegs).toBeUndefined();
  });
});
