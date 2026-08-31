import {
  addressErrorMessage,
  addressErrorStatus,
  classifyAddressError,
  type AddressErrorCode,
} from '../api/bitcoin/address-errors';

/**
 * The failure this replaces: the address family reported what went wrong only
 * through an HTTP status, and the page read that status as a diagnosis. It
 * treated 405, 413 and 504 as one condition and told all three of them "there
 * are too many transactions on this address". Exactly one of the three is
 * about the address.
 *
 * So the tests below are about keeping those meanings apart, and in particular
 * about never letting a failure of ours be described as a property of somebody
 * else's address.
 */

describe('address error classification', () => {
  it('names an oversized history as an oversized history', () => {
    // Electrum servers refuse a history past their limit with this wording,
    // and the confirmed-status variant is the same refusal on another call.
    expect(classifyAddressError(new Error('history too long'))).toBe('address-history-too-large');
    expect(classifyAddressError(new Error('cannot determine confirmed status'))).toBe('address-history-too-large');
  });

  it('names a timeout as a timeout and never as an oversized history', () => {
    const timedOut = Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' });
    expect(classifyAddressError(timedOut)).toBe('address-query-timeout');
    expect(classifyAddressError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe('address-query-timeout');
  });

  it('names an index that is not listening as unreachable, not as an oversized history', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH']) {
      expect(classifyAddressError(Object.assign(new Error('connect'), { code }))).toBe('upstream-unavailable');
    }
  });

  it('names a bad address as a bad address', () => {
    expect(classifyAddressError(new Error('Invalid Bitcoin address'))).toBe('invalid-address');
  });

  it('falls back to unreachable rather than inventing a reason it did not observe', () => {
    expect(classifyAddressError(new Error('something unexpected'))).toBe('upstream-unavailable');
    expect(classifyAddressError(null)).toBe('upstream-unavailable');
    expect(classifyAddressError({})).toBe('upstream-unavailable');
  });
});

describe('address error transport', () => {
  const codes: AddressErrorCode[] = [
    'address-backend-unavailable',
    'address-backend-syncing',
    'address-history-too-large',
    'address-query-timeout',
    'invalid-address',
    'address-source-disagreement',
    'upstream-unavailable',
  ];

  it('gives every reason a status and a sentence', () => {
    for (const code of codes) {
      expect(Number.isInteger(addressErrorStatus(code))).toBe(true);
      expect(addressErrorMessage(code).length).toBeGreaterThan(0);
    }
  });

  it('carries a missing index as a temporary server state rather than a method problem', () => {
    // It used to answer 405, which says the method is not allowed on a path
    // that answers GET perfectly well everywhere else. A cache reading only the
    // number should treat this as "not now", not as "never".
    expect(addressErrorStatus('address-backend-unavailable')).toBe(503);
    expect(addressErrorStatus('address-backend-syncing')).toBe(503);
  });

  it('keeps the oversized history on the one status that means it', () => {
    expect(addressErrorStatus('address-history-too-large')).toBe(413);
  });

  it('never describes one of our own failures as a property of the address', () => {
    for (const code of ['address-backend-unavailable', 'address-backend-syncing', 'address-query-timeout', 'upstream-unavailable'] as const) {
      expect(addressErrorMessage(code)).not.toMatch(/too many transactions/i);
    }
  });
});
