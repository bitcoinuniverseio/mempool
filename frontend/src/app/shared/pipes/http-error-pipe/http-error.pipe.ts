import { HttpErrorResponse } from '@angular/common/http';
import { Pipe, PipeTransform } from '@angular/core';

/**
 * The parenthetical detail under a failed panel's headline.
 *
 * It used to read `${e.status} ${e.statusText}: ${errorMsg}` against whatever
 * it was handed. Two things went wrong with that. The null guard came after the
 * property access, so it could never run. And anything that is not an
 * `HttpErrorResponse` has no `status` and no `statusText`, so a timeout, an
 * aborted request, or a thrown `Error` printed the string
 * "(undefined undefined: )" to the reader. That is worse than printing nothing:
 * it looks like the product is broken rather than the request.
 *
 * So this now answers with a detail a person can act on, or with nothing at
 * all. It never invents a status it was not given.
 */
@Pipe({
  name: 'httpErrorMsg',
  standalone: false,
})
export class HttpErrorPipe implements PipeTransform {
  transform(e: HttpErrorResponse | Error | null | undefined): string {
    if (!e) {
      return '';
    }

    const status = (e as HttpErrorResponse).status;
    const statusText = ((e as HttpErrorResponse).statusText || '').trim();
    const body = (e as HttpErrorResponse).error;
    const detail = (typeof body === 'string' ? body : body?.error ?? '').trim();

    // status 0 is the browser refusing to tell us why, which is a network
    // failure, a blocked request, or a cancelled one. Reporting "0" helps
    // nobody, so it is named instead.
    if (status === 0) {
      return $localize`:@@http-error.unreachable:The request did not reach the server`;
    }

    if (typeof status === 'number' && status > 0) {
      const head = statusText ? `${status} ${statusText}` : `${status}`;
      return detail ? `${head}: ${detail}` : head;
    }

    // Not an HTTP failure. Whatever message it carries is better than a
    // fabricated status, and an empty string is better than both.
    return detail || (e as Error).message || '';
  }
}
