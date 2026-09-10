import { describe, expect, it } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { QuantumOverviewComponent } from './quantum-overview.component';
import { QuantumMigrationComponent } from './quantum-migration.component';
import type { QuantumApiService } from './quantum.service';

/**
 * The backend answers these reads with a 503 that names the missing exposure
 * index. The pages must land in their error state with the shared message;
 * the migration planner used to swallow the failure and show nothing.
 */
const unavailable = new HttpErrorResponse({ status: 503, error: { stage: 'unavailable-exposure-index', error: 'absent' } });
const api = {
  getOverview$: () => throwError(() => unavailable),
  generateMigrationPlan$: () => throwError(() => unavailable),
} as unknown as QuantumApiService;
const cd = { markForCheck: () => undefined } as never;

describe('quantum pages on an absent exposure index', () => {
  it('shows the unavailable message on the overview instead of a spinner', () => {
    const page = new QuantumOverviewComponent(api, cd);
    page.ngOnInit();
    expect(page.loading).toBe(false);
    expect(page.overview).toBeNull();
    expect(page.error).toBe('The service behind this panel is unavailable.');
  });

  it('shows the unavailable message on the migration planner instead of silently continuing', () => {
    const page = new QuantumMigrationComponent(api, cd);
    page.rawOutpoints = 'ab'.repeat(32) + ':0';
    page.generatePlan();
    expect(page.planning).toBe(false);
    expect(page.result).toBeNull();
    expect(page.errorMessage).toBe('The service behind this panel is unavailable.');
  });
});
