import { BehaviorSubject, Observable, catchError, filter, of, take, tap } from 'rxjs';

/**
 * The short lived de-duplication cache the API services share.
 *
 * Three services carried their own copy of this, character for character, and
 * each copy had the same two defects.
 *
 * The first is the key. It was the function's name plus its stringified
 * arguments, and nothing else. The base path those services prefix onto every
 * URL changes when the reader switches network, so the same call with the same
 * arguments on signet and on mainnet produced one key and shared one answer:
 * whichever network asked first. The key here carries the origin and base path
 * the request actually resolved against, captured before the request is made
 * rather than read back afterwards from a field that has since changed.
 *
 * The second is the failure path. The old copy called `subject.error(...)` and
 * left the entry in the map. A `BehaviorSubject` that has errored replays that
 * error to every later subscriber for ever, so the retry the reader asked for
 * never reached the network: it re-read the same dead subject until the entry
 * expired. Here the failing entry is evicted, so the next call is a fresh
 * request, while the error still reaches the callers already waiting on it.
 */

interface CacheEntry {
  readonly subject: BehaviorSubject<unknown>;
  readonly expiry: number;
}

/** A stable identity per function reference, so a minified name cannot collide. */
const functionIds = new WeakMap<object, string>();
let nextFunctionId = 0;

export function requestIdentity(apiFunction: (...args: unknown[]) => unknown): string {
  let id = functionIds.get(apiFunction);
  if (id === undefined) {
    // The name is kept because it makes a cache key readable in a debugger; the
    // counter is what makes it unique, because a production build may give two
    // different functions the same short name.
    id = `${apiFunction.name || 'fn'}#${nextFunctionId++}`;
    functionIds.set(apiFunction, id);
  }
  return id;
}

/**
 * Builds the key for one request.
 *
 * `namespace` is the origin and base path the request resolves against, so two
 * otherwise identical calls on different networks never meet. Argument order is
 * preserved, because it is meaningful to the functions being called.
 */
export function requestCacheKey(namespace: string, identity: string, params: readonly unknown[]): string {
  return `${namespace}|${identity}|${JSON.stringify(params)}`;
}

/**
 * One bounded, de-duplicating request cache.
 *
 * Concurrent callers of the same key on the same network share one in-flight
 * request. Different keys, including the same call on a different network, do
 * not.
 */
export class RequestCache {
  private readonly entries = new Map<string, CacheEntry>();

  /** Drops entries whose window has passed, so the map cannot grow without bound. */
  private cleanExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiry < now) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Removes an entry only if the map still holds the one that failed. A later
   * call may already have replaced it, and evicting that replacement would
   * discard a live request that has done nothing wrong.
   */
  private evictIfCurrent(key: string, entry: CacheEntry): void {
    if (this.entries.get(key) === entry) {
      this.entries.delete(key);
    }
  }

  public request<T>(
    namespace: string,
    apiFunction: (...args: never[]) => Observable<T>,
    expireAfter: number,
    params: readonly unknown[],
    invoke: () => Observable<T>,
  ): Observable<T> {
    const now = Date.now();
    this.cleanExpired(now);

    const key = requestCacheKey(namespace, requestIdentity(apiFunction as (...args: unknown[]) => unknown), params);
    let entry = this.entries.get(key);

    if (!entry) {
      const subject = new BehaviorSubject<unknown>(null);
      entry = { subject, expiry: now + expireAfter };
      this.entries.set(key, entry);
      const created = entry;

      invoke().pipe(
        tap((data) => subject.next(data)),
        catchError((error) => {
          // Evict first, so a caller reacting to the error can immediately ask
          // again and get a real request rather than this dead subject.
          this.evictIfCurrent(key, created);
          subject.error(error);
          return of(null);
        }),
      ).subscribe({ error: () => { /* already delivered through the subject */ } });
    }

    return entry.subject.asObservable().pipe(
      filter((value) => value !== null),
      take(1),
    ) as Observable<T>;
  }

  /** Present for tests and for callers that need to know the cache is bounded. */
  public get size(): number {
    return this.entries.size;
  }
}
