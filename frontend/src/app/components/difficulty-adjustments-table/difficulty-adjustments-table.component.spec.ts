import { defer, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { DifficultyAdjustmentsTable } from './difficulty-adjustments-table.components';

describe('difficulty adjustments source state', () => {
  it('distinguishes a failed read from empty history and retries the read', () => {
    let reads = 0;
    const component = new DifficultyAdjustmentsTable('en', {
      getDifficultyAdjustments$: () => defer(() => {
        reads++;
        return reads === 1 ? throwError(() => new HttpErrorResponse({ status: 404 })) : of({ body: [] });
      }),
    } as any, { transform: String } as any, { network: '' } as any);
    component.ngOnInit();
    const states: any[] = [];
    const subscription = component.state$.subscribe(state => states.push(state));
    expect(states.at(-1)).toMatchObject({ status: 'error', reason: 'missing' });
    component.onRetry();
    expect(reads).toBe(2);
    expect(states.at(-1).status).toBe('empty');
    subscription.unsubscribe();
    component.onRetry();
    expect(reads).toBe(2);
  });
});
