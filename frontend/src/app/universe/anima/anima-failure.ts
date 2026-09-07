import { HttpErrorResponse } from '@angular/common/http';

/**
 * What a failed ANIMA request actually said.
 *
 * The overlay answers a missing or unreachable authority with a typed
 * document on a 503 or 502: `universe-anima-v1`, a state, a reason. The
 * list pages used to turn every error into null and then explain that the
 * explorer could not reach its own overlay, which was false whenever the
 * overlay had in fact answered. This reads the document back out of the
 * error when it is one, and names the other cases for what they are.
 */
export type AnimaFailure =
  | { readonly kind: 'unconfigured'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'transport' }
  | { readonly kind: 'malformed' };

const DOCUMENT_STATES = new Set(['unconfigured', 'unavailable']);

export function animaFailureFrom(error: unknown): AnimaFailure {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return { kind: 'transport' };
    }
    const body = error.error;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const document = body as Record<string, unknown>;
      if (
        document.schemaVersion === 'universe-anima-v1'
        && typeof document.state === 'string'
        && DOCUMENT_STATES.has(document.state)
        && typeof document.degradedReason === 'string'
        && document.degradedReason.length > 0
      ) {
        return { kind: document.state as 'unconfigured' | 'unavailable', reason: document.degradedReason };
      }
    }
    return { kind: 'malformed' };
  }
  if (error instanceof Error && error.message === 'authority-network-mismatch') {
    return { kind: 'malformed' };
  }
  return { kind: 'transport' };
}

/** A sentence for each failure that names its cause and nothing more. */
export function animaFailureText(failure: AnimaFailure): string {
  switch (failure.kind) {
    case 'unconfigured':
    case 'unavailable':
      return failure.reason;
    case 'transport':
      return $localize`:@@anima.failure-transport:The explorer could not reach its own overlay. Nothing about the ANIMA protocol is inferred from the failure.`;
    default:
      return $localize`:@@anima.failure-malformed:The overlay answered with something that is not an ANIMA document. Nothing about the ANIMA protocol is inferred from it.`;
  }
}

export function animaFailureTitle(failure: AnimaFailure): string {
  switch (failure.kind) {
    case 'unconfigured':
      return $localize`:@@anima.failure-unconfigured-title:No ANIMA authority is configured here`;
    case 'unavailable':
      return $localize`:@@anima.failure-unavailable-title:The ANIMA authority did not answer`;
    case 'transport':
      return $localize`:@@anima.failure-transport-title:The explorer overlay could not be read`;
    default:
      return $localize`:@@anima.failure-malformed-title:The overlay answer could not be read`;
  }
}
