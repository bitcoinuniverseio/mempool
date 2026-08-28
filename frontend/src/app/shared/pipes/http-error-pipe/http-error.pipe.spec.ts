import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { HttpErrorPipe } from './http-error.pipe';

/**
 * The case that produced these tests: the address page rendered
 * "(undefined undefined: )" whenever the failure was not an HTTP response,
 * because the pipe read `.status` off whatever it was given.
 */
describe('HttpErrorPipe', () => {
  const pipe = new HttpErrorPipe();

  it('says nothing when there is no error', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });

  it('reports the status and the reason', () => {
    const error = new HttpErrorResponse({ status: 404, statusText: 'Not Found' });
    expect(pipe.transform(error)).toBe('404 Not Found');
  });

  it('appends a string body as the detail', () => {
    const error = new HttpErrorResponse({
      status: 413,
      statusText: 'Payload Too Large',
      error: 'too many transactions',
    });
    expect(pipe.transform(error)).toBe('413 Payload Too Large: too many transactions');
  });

  it('appends a structured body as the detail', () => {
    const error = new HttpErrorResponse({
      status: 500,
      statusText: 'Server Error',
      error: { error: 'the index is rebuilding' },
    });
    expect(pipe.transform(error)).toBe('500 Server Error: the index is rebuilding');
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
