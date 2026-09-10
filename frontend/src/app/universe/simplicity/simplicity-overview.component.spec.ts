import { ChangeDetectorRef } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SimplicityOverviewComponent } from './simplicity-overview.component';
import { SimplicityTxComponent } from './simplicity-tx.component';
import { SimplicityApiService } from './simplicity.service';

const unavailable = () => throwError(() => new HttpErrorResponse({
  status: 503, error: { stage: 'unavailable-program-index', error: 'no program index' },
}));
const cdr = { markForCheck: vi.fn() } as unknown as ChangeDetectorRef;

describe('Simplicity pages when the program index is absent', () => {
  it('shows the overview error state rather than an empty overview', () => {
    const api = { getOverview$: unavailable } as unknown as SimplicityApiService;
    const component = new SimplicityOverviewComponent(api, cdr);
    component.ngOnInit();
    expect(component.loading).toBe(false);
    expect(component.overview).toBeNull();
    expect(component.error).toContain('unavailable');
  });

  it('does not decide a transaction has no Simplicity when the index is absent', () => {
    const api = { getTransactionExecution$: unavailable } as unknown as SimplicityApiService;
    const route = { snapshot: { paramMap: { get: () => 'ab'.repeat(32) } } } as unknown as ActivatedRoute;
    const component = new SimplicityTxComponent(route, api, cdr);
    component.ngOnInit();
    expect(component.execution).toBeNull();
    expect(component.error).toContain('unavailable');
  });
});
