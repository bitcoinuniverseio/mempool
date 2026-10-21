/**
 * Whole-request deadline for address reads.
 *
 * The Electrum and Core RPC clients carry their own per-call timeouts (up to
 * 60 s), and one address read chains several calls, so without a request-wide
 * bound a slow index held the browser for minutes. This bound answers the
 * request with a timeout and aborts the underlying work through its signal.
 *
 * 20 s keeps a healthy HDD-backed index (about 12.5 s per address read) working
 * while giving the page a bounded, neutral failure.
 */
export const ADDRESS_REQUEST_DEADLINE_MS = 20_000;

export function addressDeadlineError(): Error {
  return Object.assign(new Error('Address read deadline exceeded'), { code: 'ETIMEDOUT' });
}

/**
 * Run `read` with a signal that aborts when the caller goes away or the
 * deadline passes. The returned promise settles by the deadline even if the
 * read ignores its signal.
 */
export function withAddressDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  caller: AbortSignal,
  deadlineMs = ADDRESS_REQUEST_DEADLINE_MS,
): Promise<T> {
  const controller = new AbortController();
  const forward = (): void => controller.abort();
  if (caller.aborted) {
    controller.abort();
  } else {
    caller.addEventListener('abort', forward, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(addressDeadlineError());
    }, deadlineMs);
  });
  return Promise.race([read(controller.signal), deadline]).finally(() => {
    clearTimeout(timer);
    caller.removeEventListener('abort', forward);
  });
}
