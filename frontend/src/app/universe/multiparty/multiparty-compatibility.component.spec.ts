import { describe, expect, it } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { MultipartyCompatibilityComponent } from './multiparty-compatibility.component';

describe('hardware compatibility source absence', () => {
  it('surfaces the real 503 contract without vendor claims', () => {
    const page = new MultipartyCompatibilityComponent({ getCompatibility$: () => throwError(() => new HttpErrorResponse({ status: 503 })) } as never, { markForCheck() {} } as never);
    page.ngOnInit(); expect(page.loading).toBe(false);
    expect(page.error).toBe('The service behind this panel is unavailable.'); page.ngOnDestroy();
  });
  it('does not treat an arbitrary response as verified compatibility', () => {
    const page = new MultipartyCompatibilityComponent({ getCompatibility$: () => of({ supported: true }) } as never, { markForCheck() {} } as never);
    page.ngOnInit(); expect(page.error).toContain('no supported verification contract');
  });
});
