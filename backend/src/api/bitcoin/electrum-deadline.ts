/**
 * Bounds one Electrum request in time.
 *
 * The Electrum client library resolves a request only when the server answers
 * with the same id, and it clears its socket timeout once connected. A reply
 * the server drops therefore leaves the caller waiting forever. On 2026-09-07
 * the main update loop hung that way for eleven hours: the block cache froze
 * at 965905 while Core advanced to 965975, the mempool snapshot stopped
 * changing, and nothing logged because the request never settled.
 *
 * A deadline turns that silence into an error the loop already knows how to
 * retry. The request itself is not cancelled, so a late reply is ignored
 * rather than misattributed.
 */
export const ELECTRUM_REQUEST_TIMEOUT_MS = 60_000;

export class ElectrumDeadlineError extends Error {
  constructor(readonly method: string, readonly timeoutMs: number) {
    super(`Electrum request ${method} did not answer within ${timeoutMs} ms`);
    this.name = 'ElectrumDeadlineError';
  }
}

export function withElectrumDeadline<T = any>(
  request: Promise<T>,
  method: string,
  timeoutMs: number = ELECTRUM_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ElectrumDeadlineError(method, timeoutMs)), timeoutMs);
  });
  return (Promise.race([request, deadline]) as Promise<T>).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
