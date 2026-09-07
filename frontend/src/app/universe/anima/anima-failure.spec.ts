import { describe, expect, it } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { animaFailureFrom, animaFailureText, animaFailureTitle } from './anima-failure';

function http(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error, url: 'http://explorer.invalid/api/v1/anima/status' });
}

describe('ANIMA failure reading', () => {
  it('keeps the typed unconfigured document the overlay served on a 503', () => {
    const failure = animaFailureFrom(http(503, {
      schemaVersion: 'universe-anima-v1',
      state: 'unconfigured',
      degradedReason: 'No index-anima authority is configured in this deployment.',
    }));
    expect(failure).toEqual({ kind: 'unconfigured', reason: 'No index-anima authority is configured in this deployment.' });
    expect(animaFailureTitle(failure)).toBe('No ANIMA authority is configured here');
    expect(animaFailureText(failure)).toBe('No index-anima authority is configured in this deployment.');
  });

  it('keeps the typed unavailable document the overlay served on a 502', () => {
    const failure = animaFailureFrom(http(502, {
      schemaVersion: 'universe-anima-v1',
      state: 'unavailable',
      degradedReason: 'The index-anima authority did not answer (transport).',
    }));
    expect(failure).toEqual({ kind: 'unavailable', reason: 'The index-anima authority did not answer (transport).' });
    expect(animaFailureTitle(failure)).toBe('The ANIMA authority did not answer');
  });

  it('names a status 0 network failure as the overlay being unreachable', () => {
    const failure = animaFailureFrom(http(0, { type: 'error' }));
    expect(failure).toEqual({ kind: 'transport' });
    expect(animaFailureTitle(failure)).toBe('The explorer overlay could not be read');
  });

  it('does not treat an HTML error page or a foreign document as an ANIMA document', () => {
    expect(animaFailureFrom(http(502, '<html><body>Bad Gateway</body></html>'))).toEqual({ kind: 'malformed' });
    expect(animaFailureFrom(http(503, { error: 'Service Unavailable' }))).toEqual({ kind: 'malformed' });
    expect(animaFailureFrom(http(503, { schemaVersion: 'universe-anima-v1', state: 'served', degradedReason: null }))).toEqual({ kind: 'malformed' });
    expect(animaFailureFrom(http(503, { schemaVersion: 'universe-anima-v1', state: 'unconfigured', degradedReason: '' }))).toEqual({ kind: 'malformed' });
  });

  it('reads a network mismatch raised by the API layer as a malformed answer', () => {
    expect(animaFailureFrom(new Error('authority-network-mismatch'))).toEqual({ kind: 'malformed' });
  });

  it('treats an unknown error shape as a transport failure', () => {
    expect(animaFailureFrom(undefined)).toEqual({ kind: 'transport' });
    expect(animaFailureFrom(new Error('boom'))).toEqual({ kind: 'transport' });
  });
});
