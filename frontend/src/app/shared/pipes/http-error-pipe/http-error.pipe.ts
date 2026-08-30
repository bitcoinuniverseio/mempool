import { HttpErrorResponse } from '@angular/common/http';
import { Pipe, PipeTransform } from '@angular/core';

/**
 * The parenthetical technical detail under a failed panel's headline.
 *
 * It exists to help somebody report a problem, not to explain one. The
 * explanation is the panel's own copy, written for the state it is actually
 * in, and this line carries only what came back on the wire.
 *
 * It used to include the status line's reason phrase, and that produced
 * "(405 OK)" on the public address page. The number came from the backend and
 * the word came from somewhere in the proxy chain, which is free to write
 * whatever it likes there or nothing at all, and the two were pasted together
 * and shown as if they were one authoritative statement. A reason phrase is
 * not a diagnosis and is not from a source this page can vouch for, so it is
 * no longer read at all.
 *
 * What is left is the number, which is ours, and the message the backend put
 * in the body, which is also ours.
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
    const body = (e as HttpErrorResponse).error;
    const detail = this.detailFrom(body);

    // status 0 is the browser refusing to tell us why, which is a network
    // failure, a blocked request, or a cancelled one. Reporting "0" helps
    // nobody, so it is named instead.
    if (status === 0) {
      return $localize`:@@http-error.unreachable:The request did not reach the server`;
    }

    if (typeof status === 'number' && status > 0) {
      return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
    }

    // Not an HTTP failure. Whatever message it carries is better than a
    // fabricated status, and an empty string is better than both.
    return detail || (e as Error).message || '';
  }

  /**
   * The detail the backend sent, and nothing the transport made up.
   *
   * A typed failure carries both a sentence and a name; the name is what the
   * page branches on, and the sentence is what belongs here.
   */
  private detailFrom(body: unknown): string {
    if (typeof body === 'string') {
      const text = body.trim();
      if (!text.startsWith('{')) {
        return text;
      }
      try {
        return this.detailFrom(JSON.parse(text));
      } catch {
        return text;
      }
    }
    if (body && typeof body === 'object') {
      const named = body as { error?: unknown; code?: unknown };
      if (typeof named.error === 'string') {
        return named.error.trim();
      }
      if (typeof named.code === 'string') {
        return named.code.trim();
      }
    }
    return '';
  }
}
