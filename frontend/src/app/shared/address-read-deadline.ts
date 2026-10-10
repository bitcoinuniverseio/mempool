import { HttpErrorResponse } from '@angular/common/http';
import { OperatorFunction, throwError, timeout } from 'rxjs';

export const ADDRESS_READ_DEADLINE_MS = 60_000;

/** Cancel an unanswered browser request without changing the native query limits. */
export function addressReadDeadline<T>(): OperatorFunction<T, T> {
  return timeout({ first: ADDRESS_READ_DEADLINE_MS,
    with: () => throwError(() => new HttpErrorResponse({ status: 504, error: { code: 'address-query-timeout' } })) });
}
