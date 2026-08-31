import { HttpErrorResponse } from '@angular/common/http';

/**
 * What actually went wrong with an address lookup, as far as the page is
 * allowed to claim.
 *
 * The page used to decide this from the HTTP status alone, and it grouped 405,
 * 413 and 504 into one branch that said "there are too many transactions on
 * this address, more than the backend can handle". Only 413 is about the
 * address. 405 was a deployment with no address index at all and 504 was a
 * request that ran out of time, and both of those were reported to the reader
 * as a fact about their own address.
 *
 * So the reason now comes from the backend as a name, and the status is only
 * consulted when there is no name to read: a proxy in the path can rewrite a
 * status line but it does not invent a body.
 */
export type AddressFailure =
  /** No index is configured, or the one that is cannot be reached. */
  | 'backend-unavailable'
  /** An index is there and still building. */
  | 'backend-syncing'
  /** The address genuinely has more history than the limit serves. */
  | 'history-too-large'
  /** The index was reachable and did not answer in time. */
  | 'timeout'
  /** The string in the URL is not an address. */
  | 'invalid-address'
  /** The index answered, and has nothing under this address. */
  | 'not-found'
  /** Nothing said what happened, so the page says that instead of guessing. */
  | 'unknown';

/** The names the backend and the gateway use, mapped to what the page renders. */
const BY_CODE: Readonly<Record<string, AddressFailure>> = {
  'address-backend-unavailable': 'backend-unavailable',
  'address-backend-syncing': 'backend-syncing',
  'address-history-too-large': 'history-too-large',
  'address-query-timeout': 'timeout',
  'invalid-address': 'invalid-address',
  'address-source-disagreement': 'backend-unavailable',
  // The gateway answers this when the upstream that owns the path is not
  // listening, which from a reader's side is the index being unavailable.
  'upstream-unavailable': 'backend-unavailable',
};

/**
 * Statuses, used only when the body carried no name.
 *
 * 405 is here deliberately. A backend from before the typed reasons existed
 * answers the whole address family with it, and the one thing that must never
 * happen again is that status being read as a statement about the address.
 */
const BY_STATUS: Readonly<Record<number, AddressFailure>> = {
  400: 'invalid-address',
  404: 'not-found',
  405: 'backend-unavailable',
  413: 'history-too-large',
  501: 'invalid-address',
  502: 'backend-unavailable',
  503: 'backend-unavailable',
  504: 'timeout',
};

/** Reads the machine-readable reason out of an error body, when there is one. */
export function addressErrorCode(error: unknown): string | null {
  const body = (error as HttpErrorResponse | null)?.error;
  if (!body) {
    return null;
  }
  if (typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string') {
    return (body as { code: string }).code;
  }
  // A body that arrived as text, which is what happens when a proxy in the
  // path rewrites the content type.
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return typeof parsed?.code === 'string' ? parsed.code : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function classifyAddressFailure(error: unknown): AddressFailure {
  if (!error) {
    return 'unknown';
  }
  const code = addressErrorCode(error);
  if (code && BY_CODE[code]) {
    return BY_CODE[code];
  }
  const status = (error as HttpErrorResponse).status;
  if (typeof status === 'number' && BY_STATUS[status]) {
    return BY_STATUS[status];
  }
  // Status 0 is the browser declining to say why. It is a network failure, a
  // blocked request or a cancelled one, and none of those is a fact about the
  // address either.
  return 'unknown';
}

/**
 * Whether the page should ask the deployment what state its address index is
 * in before it settles on wording.
 *
 * Only for the failures that are about our infrastructure. An oversized
 * history and an invalid address are already fully explained, and asking about
 * them would put a request on the wire for nothing.
 */
export function shouldConsultCapability(failure: AddressFailure): boolean {
  return failure === 'backend-unavailable' || failure === 'backend-syncing' || failure === 'unknown';
}
