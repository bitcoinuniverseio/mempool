import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { addressErrorCode, classifyAddressFailure, shouldConsultCapability } from './address-error';

/**
 * The production screenshot this exists to make impossible.
 *
 * An address page on the live site, with no address index behind it, showing:
 * "Error loading address data. (405 OK: Address lookups cannot be used with
 * bitcoind as backend.) There are too many transactions on this address, more
 * than the backend can handle."
 *
 * Three separate wrongs in four lines. The status was 405, which is not what
 * that condition is. The reason phrase said OK next to it. And the sentence
 * underneath told the reader it was their address, when the deployment simply
 * had no index at all.
 *
 * These tests hold each of the failure conditions to its own meaning, and in
 * particular hold every failure that is ours to never being described as a
 * property of somebody else's address.
 */

function httpError(status: number, body?: unknown, statusText = 'OK'): HttpErrorResponse {
  return new HttpErrorResponse({ status, statusText, error: body });
}

describe('address failure classification', () => {
  it('reads the reason the backend named, in preference to the status', () => {
    // The body is the only part of the response a proxy does not rewrite.
    const error = httpError(503, { error: 'still catching up', code: 'address-backend-syncing' });
    expect(classifyAddressFailure(error)).toBe('backend-syncing');
  });

  it('reads a typed reason out of a body that arrived as text', () => {
    const error = httpError(503, '{"error":"no index","code":"address-backend-unavailable"}');
    expect(addressErrorCode(error)).toBe('address-backend-unavailable');
    expect(classifyAddressFailure(error)).toBe('backend-unavailable');
  });

  it('maps every reason the backend and gateway can send', () => {
    const cases: Array<[string, string]> = [
      ['address-backend-unavailable', 'backend-unavailable'],
      ['address-backend-syncing', 'backend-syncing'],
      ['address-history-too-large', 'history-too-large'],
      ['address-query-timeout', 'timeout'],
      ['invalid-address', 'invalid-address'],
      ['address-source-disagreement', 'backend-unavailable'],
      ['upstream-unavailable', 'backend-unavailable'],
    ];
    for (const [code, expected] of cases) {
      expect(classifyAddressFailure(httpError(500, { code }))).toBe(expected);
    }
  });

  /**
   * The exact defect. A backend from before the typed reasons existed answers
   * the whole address family with 405, and that must never again be read as a
   * statement about how much history the address has.
   */
  it('never reads a 405 as the address having too much history', () => {
    const error = httpError(405, { error: 'Address lookups cannot be used with bitcoind as backend.' });
    expect(classifyAddressFailure(error)).toBe('backend-unavailable');
    expect(classifyAddressFailure(error)).not.toBe('history-too-large');
  });

  it('never reads a timeout as the address having too much history', () => {
    expect(classifyAddressFailure(httpError(504))).toBe('timeout');
    expect(classifyAddressFailure(httpError(504))).not.toBe('history-too-large');
  });

  it('keeps the oversized history on the one status that means it', () => {
    expect(classifyAddressFailure(httpError(413))).toBe('history-too-large');
  });

  it('reads an index that is not listening as unavailable', () => {
    // This is what the gateway answers when the upstream that owns the path is
    // down, and it is about us, not about the address.
    expect(classifyAddressFailure(httpError(502, { error: 'upstream-unavailable' }))).toBe('backend-unavailable');
    expect(classifyAddressFailure(httpError(503))).toBe('backend-unavailable');
  });

  it('reads a rejected address as a rejected address', () => {
    expect(classifyAddressFailure(httpError(400))).toBe('invalid-address');
    expect(classifyAddressFailure(httpError(501))).toBe('invalid-address');
  });

  it('says it does not know rather than guessing', () => {
    // Status 0 is the browser declining to explain, which is a network
    // failure, a blocked request or a cancelled one. None of those is a fact
    // about the address either.
    expect(classifyAddressFailure(httpError(0, null, 'Unknown Error'))).toBe('unknown');
    expect(classifyAddressFailure(new Error('boom'))).toBe('unknown');
    expect(classifyAddressFailure(null)).toBe('unknown');
  });

  it('asks the deployment only about failures that are ours', () => {
    expect(shouldConsultCapability('backend-unavailable')).toBe(true);
    expect(shouldConsultCapability('backend-syncing')).toBe(true);
    expect(shouldConsultCapability('unknown')).toBe(true);
    // These two are already fully explained; asking would put a request on the
    // wire and change nothing that is shown.
    expect(shouldConsultCapability('history-too-large')).toBe(false);
    expect(shouldConsultCapability('invalid-address')).toBe(false);
  });
});
