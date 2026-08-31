import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { HttpErrorPipe } from './http-error.pipe';

/**
 * Two production defects produced these tests.
 *
 * The address page rendered "(undefined undefined: )" whenever the failure was
 * not an HTTP response, because the pipe read `.status` off whatever it was
 * given. And it rendered "(405 OK)" on the live site, because it pasted the
 * status number to the status line's reason phrase, which a proxy in the path
 * had rewritten to something that flatly contradicted it.
 */
describe('HttpErrorPipe', () => {
  const pipe = new HttpErrorPipe();

  it('says nothing when there is no error', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });

  it('reports the status on its own when there is no body to quote', () => {
    const error = new HttpErrorResponse({ status: 404, statusText: 'Not Found' });
    expect(pipe.transform(error)).toBe('HTTP 404');
  });

  it('appends a string body as the detail', () => {
    const error = new HttpErrorResponse({
      status: 413,
      statusText: 'Payload Too Large',
      error: 'too many transactions',
    });
    expect(pipe.transform(error)).toBe('HTTP 413: too many transactions');
  });

  it('appends a structured body as the detail', () => {
    const error = new HttpErrorResponse({
      status: 500,
      statusText: 'Server Error',
      error: { error: 'the index is rebuilding' },
    });
    expect(pipe.transform(error)).toBe('HTTP 500: the index is rebuilding');
  });

  it('reads a JSON body that arrived as text', () => {
    // A proxy that rewrites the content type leaves the body a string, and the
    // sentence inside it is still the one worth showing.
    const error = new HttpErrorResponse({
      status: 503,
      error: '{"error":"The Bitcoin address index is still catching up.","code":"address-backend-syncing"}',
    });
    expect(pipe.transform(error)).toBe('HTTP 503: The Bitcoin address index is still catching up.');
  });

  /**
   * The live defect. `statusText` is written by whatever last touched the
   * response and is under no obligation to agree with the number beside it.
   * Rendering the two together presented a contradiction as a diagnosis.
   */
  it('never repeats a reason phrase that contradicts the status', () => {
    const error = new HttpErrorResponse({
      status: 405,
      statusText: 'OK',
      error: { error: 'Address lookups cannot be used with bitcoind as backend.' },
    });
    const result = pipe.transform(error);
    expect(result).not.toContain('405 OK');
    expect(result).not.toContain('OK');
    expect(result).toContain('405');
  });

  it('ignores a reason phrase even when nothing else is available', () => {
    expect(pipe.transform(new HttpErrorResponse({ status: 502, statusText: 'Unknown Error' })))
      .toBe('HTTP 502');
  });

  it('names a status 0 rather than printing the zero', () => {
    const error = new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' });
    expect(pipe.transform(error)).toBe('The request did not reach the server');
  });

  it('never prints an undefined status for a plain error', () => {
    const result = pipe.transform(new Error('timed out'));
    expect(result).toBe('timed out');
    expect(result).not.toContain('undefined');
  });

  it('says nothing rather than inventing a status', () => {
    const result = pipe.transform({} as Error);
    expect(result).toBe('');
    expect(result).not.toContain('undefined');
  });
});
