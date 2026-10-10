import { Observable, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addressReadDeadline, ADDRESS_READ_DEADLINE_MS } from './address-read-deadline';
import { classifyAddressFailure } from './address-error';

afterEach(() => vi.useRealTimers());
describe('address client deadline', () => {
  it('cancels an unanswered request and supplies the retryable timeout reason', () => {
    vi.useFakeTimers(); const stopped = vi.fn(); const error = vi.fn();
    new Observable(() => stopped).pipe(addressReadDeadline()).subscribe({ error });
    vi.advanceTimersByTime(ADDRESS_READ_DEADLINE_MS - 1); expect(error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(stopped).toHaveBeenCalledTimes(1);
    expect(classifyAddressFailure(error.mock.calls[0][0])).toBe('timeout');
  });
  it('preserves successful empty history and the native busy reason', () => {
    const value = vi.fn(), error = vi.fn(); of([]).pipe(addressReadDeadline()).subscribe(value);
    expect(value).toHaveBeenCalledWith([]);
    const busy = { status: 429, error: { code: 'address-backend-busy' } };
    throwError(() => busy).pipe(addressReadDeadline()).subscribe({ error });
    expect(error).toHaveBeenCalledWith(busy);
  });
  it('navigation cancellation tears down the request without a later timeout', () => {
    vi.useFakeTimers(); const stopped = vi.fn(), error = vi.fn();
    const subscription = new Observable(() => stopped).pipe(addressReadDeadline()).subscribe({ error });
    subscription.unsubscribe(); vi.advanceTimersByTime(ADDRESS_READ_DEADLINE_MS);
    expect(stopped).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled();
  });
});
