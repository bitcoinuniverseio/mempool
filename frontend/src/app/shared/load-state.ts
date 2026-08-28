import { Observable, of, timer, throwError } from 'rxjs';
import { catchError, map, retry, startWith, switchMap, timeout } from 'rxjs/operators';
import { HttpErrorResponse } from '@angular/common/http';

/**
 * A bounded lifecycle for one remote read.
 *
 * The pages this replaces subscribed with a single next handler and no error
 * handler, so a failing request left a spinner or a skeleton on screen with
 * nothing left subscribed to ever clear it. Every path here ends in a terminal
 * state, and the states keep empty, stale, unavailable and failed apart instead
 * of collapsing them into one blank panel.
 */

export type LoadFailure =
  /** The request did not finish inside its budget. */
  | 'timeout'
  /** The route is not served by this deployment. */
  | 'missing'
  /** The dependency behind the route is down. */
  | 'unavailable'
  /** The answer did not have the shape this page can render. */
  | 'malformed'
  /** The request never reached the server. */
  | 'network';

export type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'data'; readonly value: T; readonly at: number }
  | { readonly status: 'empty'; readonly at: number }
  /** A previous good answer, kept on screen and labelled, after a later failure. */
  | { readonly status: 'stale'; readonly value: T; readonly at: number; readonly reason: LoadFailure }
  | { readonly status: 'error'; readonly reason: LoadFailure; readonly at: number };

export interface LoadOptions<T> {
  /** Overall budget for one attempt, including retries. Defaults to 20 seconds. */
  readonly timeoutMs?: number;
  /** Answers that are valid but have nothing to show. Defaults to an empty array. */
  readonly isEmpty?: (value: T) => boolean;
  /** How many times a retryable failure is retried. Defaults to two. */
  readonly retries?: number;
  /** Base backoff before the first retry, in milliseconds. Defaults to 500. */
  readonly retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAXIMUM_RETRY_DELAY_MS = 8_000;

function defaultIsEmpty(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

/** Classifies a thrown value into the failure kinds the templates render. */
export function classifyLoadFailure(error: unknown): LoadFailure {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 404) return 'missing';
    if (error.status === 0) return 'network';
    if (error.status >= 500) return 'unavailable';
    if (error.status >= 400) return 'missing';
  }
  const name = (error as { name?: string })?.name;
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'HttpErrorResponse') return 'unavailable';
  return 'malformed';
}

/**
 * Retrying a 404 or a 4xx cannot help: the route is simply not served here.
 * Retrying a timeout or a 5xx can, so those get a small bounded backoff.
 */
export function isRetryableFailure(reason: LoadFailure): boolean {
  return reason === 'timeout' || reason === 'unavailable' || reason === 'network';
}

/**
 * Wraps one request so it always resolves to a terminal state.
 *
 * `previous` carries the last good answer for this key. When a later attempt
 * fails, that answer is shown again as `stale` with the reason, rather than
 * being replaced by a blank panel.
 */
export function toLoadState<T>(
  request$: Observable<T>,
  options: LoadOptions<T> = {},
  previous: { value: T; at: number } | null = null,
): Observable<LoadState<T>> {
  const isEmpty = options.isEmpty ?? defaultIsEmpty;
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  const baseDelay = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  return request$.pipe(
    retry({
      count: maxRetries,
      delay: (error, attempt) => {
        if (!isRetryableFailure(classifyLoadFailure(error))) {
          return throwError(() => error);
        }
        // Exponential backoff with jitter, so a shared outage does not turn
        // every open tab into a synchronised retry storm.
        const ceiling = Math.min(baseDelay * Math.pow(2, attempt - 1), MAXIMUM_RETRY_DELAY_MS);
        return timer(Math.round(ceiling * (0.5 + Math.random() * 0.5)));
      },
    }),
    // The budget covers the retries too, so a dependency that hangs cannot hold
    // the page past the deadline however many attempts are left.
    timeout({ first: options.timeoutMs ?? DEFAULT_TIMEOUT_MS }),
    map((value): LoadState<T> => {
      const at = Date.now();
      if (value === null || value === undefined) {
        return { status: 'error', reason: 'malformed', at };
      }
      return isEmpty(value) ? { status: 'empty', at } : { status: 'data', value, at };
    }),
    catchError((error) => {
      const reason = classifyLoadFailure(error);
      const at = Date.now();
      return of<LoadState<T>>(
        previous
          ? { status: 'stale', value: previous.value, at: previous.at, reason }
          : { status: 'error', reason, at },
      );
    }),
    startWith<LoadState<T>>({ status: 'loading' }),
  );
}

/**
 * Runs `build` for every trigger, keeping the last good answer so a later
 * failure degrades to `stale` instead of to a blank panel. Switching means an
 * obsolete request is cancelled the moment a new one starts.
 */
export function trackedLoadState<K, T>(
  trigger$: Observable<K>,
  build: (key: K) => Observable<T>,
  options: LoadOptions<T> = {},
): Observable<LoadState<T>> {
  let previous: { value: T; at: number } | null = null;
  let previousKey: K | undefined;
  return trigger$.pipe(
    switchMap((key) => {
      // A different range is different data; last known good does not carry over.
      if (previousKey !== undefined && previousKey !== key) {
        previous = null;
      }
      previousKey = key;
      return toLoadState(build(key), options, previous).pipe(
        map((state) => {
          if (state.status === 'data') {
            previous = { value: state.value, at: state.at };
          }
          return state;
        }),
      );
    }),
  );
}

/** Human-readable reason, for the message a failed panel shows. */
export function loadFailureMessage(reason: LoadFailure): string {
  switch (reason) {
    case 'missing':
      return $localize`:@@load.failure.missing:This deployment does not serve this data yet.`;
    case 'unavailable':
      return $localize`:@@load.failure.unavailable:The service behind this panel is unavailable.`;
    case 'timeout':
      return $localize`:@@load.failure.timeout:This took too long to answer.`;
    case 'network':
      return $localize`:@@load.failure.network:The request could not reach the server.`;
    default:
      return $localize`:@@load.failure.malformed:The answer could not be read.`;
  }
}
