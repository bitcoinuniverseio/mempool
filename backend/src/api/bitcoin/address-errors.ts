import { Request, Response } from 'express';

/**
 * Stable names for the ways an address lookup can fail.
 *
 * The address family used to say what went wrong only through an HTTP status,
 * and the frontend read that status as a diagnosis. It grouped 405, 413 and 504
 * together and told every one of them "there are too many transactions on this
 * address", so a deployment with no address index at all, a request that timed
 * out, and an address that genuinely has more history than the limit allows all
 * produced the same confident and mostly wrong sentence. One of those three is
 * about the address. The other two are about us.
 *
 * A status cannot carry that distinction: 503 means the same thing whether the
 * index is missing or still building, and a proxy in the path is free to
 * rewrite the reason phrase. So the reason travels as a name in the body, the
 * status stays a transport signal, and the reader is told which of these it is.
 */
export type AddressErrorCode =
  /** No address index is configured for this deployment. */
  | 'address-backend-unavailable'
  /** An index is configured and running, but has not caught up to the chain. */
  | 'address-backend-syncing'
  /** The address really does have more history than the configured limit serves. */
  | 'address-history-too-large'
  /** The index was reachable and did not answer inside the request budget. */
  | 'address-query-timeout'
  /** The string in the URL is not an address on this network. */
  | 'invalid-address'
  /** Two configured sources disagreed about the same address. */
  | 'address-source-disagreement'
  /** The upstream that owns this path could not be reached at all. */
  | 'upstream-unavailable';

/** The body every address failure answers with. */
export interface AddressErrorBody {
  /** Human-readable, and deliberately not what the frontend keys on. */
  readonly error: string;
  readonly code: AddressErrorCode;
}

/**
 * The transport status that carries each reason.
 *
 * These are chosen so a cache, a proxy, or a client that understands nothing
 * but the number still behaves sensibly: the two "not ready" reasons are
 * temporary server states, the oversized history is a request the server
 * refuses on size, and an invalid address is the caller's mistake.
 */
const STATUS: Readonly<Record<AddressErrorCode, number>> = {
  'address-backend-unavailable': 503,
  'address-backend-syncing': 503,
  'address-history-too-large': 413,
  'address-query-timeout': 504,
  'invalid-address': 400,
  'address-source-disagreement': 409,
  'upstream-unavailable': 502,
};

const MESSAGE: Readonly<Record<AddressErrorCode, string>> = {
  'address-backend-unavailable': 'This deployment has no Bitcoin address index, so address history cannot be served.',
  'address-backend-syncing': 'The Bitcoin address index is still catching up to the chain.',
  'address-history-too-large': 'This address has more history than the configured lookup limit can serve.',
  'address-query-timeout': 'The Bitcoin address index did not answer in time.',
  'invalid-address': 'That is not a valid address on this network.',
  'address-source-disagreement': 'Two address sources disagreed about this address.',
  'upstream-unavailable': 'The Bitcoin address index could not be reached.',
};

export function addressErrorStatus(code: AddressErrorCode): number {
  return STATUS[code];
}

export function addressErrorMessage(code: AddressErrorCode): string {
  return MESSAGE[code];
}

/**
 * Turns whatever an address backend threw into one of the reasons above.
 *
 * The Electrum and Esplora clients both report an oversized history by
 * throwing a message rather than a type, so the strings they use are matched
 * here in one place instead of being re-matched at every call site, which is
 * how the timeout case ended up wearing the oversized-history answer.
 */
export function classifyAddressError(e: unknown): AddressErrorCode {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const code = (e as { code?: string } | null)?.code;

  if (message === 'Invalid Bitcoin address') {
    return 'invalid-address';
  }
  // Electrum servers answer an address whose history exceeds their limit with
  // "history too long"; the confirmed-status variant is the same refusal
  // reached through a different call.
  if (message.includes('too long') || message.includes('confirmed status')) {
    return 'address-history-too-large';
  }
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(message)) {
    return 'address-query-timeout';
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    return 'upstream-unavailable';
  }
  return 'upstream-unavailable';
}

/**
 * Answers with a reason a client can act on.
 *
 * `error` keeps carrying a sentence so anything reading the old shape still
 * finds one, and `code` is what a client should branch on.
 */
export function sendAddressError(req: Request, res: Response, code: AddressErrorCode, detail?: string): void {
  const body: AddressErrorBody = {
    error: detail ? `${MESSAGE[code]} ${detail}` : MESSAGE[code],
    code,
  };
  res.status(STATUS[code]);
  if (req.accepts('json')) {
    res.json(body);
  } else {
    res.send(body.error);
  }
}
