import { ChangeDetectorRef } from '@angular/core';
import { Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapPlannerComponent } from './bootstrap-planner.component';
import { BootstrapApiService } from './bootstrap.service';

describe('bootstrap planner source failures', () => {
  it('does not fabricate a projection when the owned planner is unavailable', () => {
    const api = { generateBootstrapPlan$: () => throwError(() => ({ status: 503 })) } as unknown as BootstrapApiService;
    const component = new BootstrapPlannerComponent(api, { markForCheck: vi.fn() } as unknown as ChangeDetectorRef);
    expect(component.plan).toBeNull();
    expect(component.calculating).toBe(false);
    expect(component.failure).toBeTruthy();
  });

  it('clears a previous failure while retrying and displays only the returned projection', () => {
    const response = new Subject<unknown>();
    const api = { generateBootstrapPlan$: vi.fn()
      .mockReturnValueOnce(throwError(() => ({ status: 503 })))
      .mockReturnValueOnce(response) } as unknown as BootstrapApiService;
    const component = new BootstrapPlannerComponent(api, { markForCheck: vi.fn() } as unknown as ChangeDetectorRef);
    component.calculatePlan();
    expect(component.failure).toBeNull();
    expect(component.plan).toBeNull();
    expect(component.calculating).toBe(true);
    const plan = { assumeutxo_ready_hours: 4, traditional_ibd_hours: 20, background_validation_hours: 25 };
    response.next(plan);
    response.complete();
    expect(component.plan).toBe(plan);
    expect(component.calculating).toBe(false);
  });
});
