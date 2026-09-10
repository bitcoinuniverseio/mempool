import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { NetworkObservatoryComponent } from './network-observatory.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));

function observe(api: Partial<UniverseApiService>): any {
  const view = new NetworkObservatoryComponent(api as UniverseApiService, { setTitle: vi.fn() } as unknown as SeoService);
  view.ngOnInit();
  let observed: any;
  view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
  return observed;
}

describe('Network observatory on an absent source', () => {
  it('shows the error state with the reason when the fleet read fails', () => {
    const vm = observe({ getObserverNodes$: unavailable, getPropagationObservation$: unavailable, getBlockTemplateComparison$: unavailable });
    expect(vm.kind).toBe('error');
    expect(vm.message).toBeTruthy();
    expect(vm.propagation).toBeUndefined();
  });

  it('does not show a timeline over an empty fleet table when only the node read fails', () => {
    const vm = observe({
      getObserverNodes$: unavailable,
      getPropagationObservation$: () => of({ txid: 'ab'.repeat(32), nodeObservations: [] }),
      getBlockTemplateComparison$: () => of({ blockHeight: 1, candidateTemplates: [] }),
    });
    expect(vm.kind).toBe('error');
    expect(vm.nodes).toBeUndefined();
  });
});
