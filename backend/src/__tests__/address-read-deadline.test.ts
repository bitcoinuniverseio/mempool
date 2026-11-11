import { ADDRESS_REQUEST_DEADLINE_MS, withAddressDeadline } from '../api/bitcoin/address-read-deadline';
import { addressErrorStatus, classifyAddressError } from '../api/bitcoin/address-errors';

/**
 * A slow or wedged address index must end the request with a bounded,
 * classified timeout instead of holding the page, and the abandoned read must
 * be told to stop.
 */
describe('address request deadline', () => {
  afterEach(() => jest.useRealTimers());

  it('stays above one healthy HDD-backed address read', () => {
    expect(ADDRESS_REQUEST_DEADLINE_MS).toBeGreaterThan(12_500);
    expect(ADDRESS_REQUEST_DEADLINE_MS).toBeLessThanOrEqual(20_000);
  });

  it('cleans up the deadline after a synchronous adapter failure', async () => {
    jest.useFakeTimers();
    const caller = new AbortController();
    await expect(withAddressDeadline(() => { throw new Error('unsupported'); }, caller.signal)).rejects.toThrow('unsupported');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns a read that finishes in time', async () => {
    const caller = new AbortController();
    await expect(withAddressDeadline(async () => ({ address: 'bc1q' }), caller.signal, 50)).resolves.toEqual({ address: 'bc1q' });
  });

  it('times out a read that never answers and aborts its signal', async () => {
    jest.useFakeTimers();
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    const pending = withAddressDeadline(signal => { seen = signal; return new Promise<never>(() => undefined); }, caller.signal, 1000);
    jest.advanceTimersByTime(1000);
    const error = await pending.catch(e => e);
    expect(seen?.aborted).toBe(true);
    expect(classifyAddressError(error)).toBe('address-query-timeout');
    expect(addressErrorStatus(classifyAddressError(error))).toBe(504);
  });

  it('settles by the deadline even when the read ignores its signal', async () => {
    jest.useFakeTimers();
    const caller = new AbortController();
    const pending = withAddressDeadline(() => new Promise<never>(() => undefined), caller.signal, 500);
    jest.advanceTimersByTime(500);
    await expect(pending).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  });

  it('forwards a client disconnect to the read', async () => {
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    const pending = withAddressDeadline(signal => {
      seen = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))));
    }, caller.signal, 10_000);
    caller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(seen?.aborted).toBe(true);
  });

  it('keeps an upstream failure distinct from a timeout', async () => {
    const caller = new AbortController();
    const error = await withAddressDeadline(async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); }, caller.signal, 1000).catch(e => e);
    expect(classifyAddressError(error)).toBe('upstream-unavailable');
  });
});
