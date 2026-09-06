import { describe, expect, it, vi } from 'vitest';
import { Observable, Subject, of, throwError } from 'rxjs';
import { RequestCache, requestCacheKey, requestIdentity } from './request-cache';

/**
 * These cases are written against the two faults the three API services shared.
 *
 * "the same call on two networks" fails on the old key, which was the function
 * name and the arguments only. "a failed request is retried" fails on the old
 * failure path, which errored the cached subject and left it in the map, so
 * every later caller replayed the same error without a request being made.
 */
describe('shared request cache', () => {
  const listStatistics$ = (timespan: string): Observable<string> => of(`stats:${timespan}`);

  it('gives one function reference one identity, and two references two', () => {
    const other = (timespan: string): Observable<string> => of(timespan);
    expect(requestIdentity(listStatistics$ as never)).toBe(requestIdentity(listStatistics$ as never));
    expect(requestIdentity(listStatistics$ as never)).not.toBe(requestIdentity(other as never));
  });

  it('keeps the namespace, the identity and the arguments apart in the key', () => {
    expect(requestCacheKey('/signet', 'f#1', ['a'])).not.toBe(requestCacheKey('', 'f#1', ['a']));
    expect(requestCacheKey('', 'f#1', ['a'])).not.toBe(requestCacheKey('', 'f#2', ['a']));
    expect(requestCacheKey('', 'f#1', ['a'])).not.toBe(requestCacheKey('', 'f#1', ['b']));
    expect(requestCacheKey('', 'f#1', ['a', 'b'])).not.toBe(requestCacheKey('', 'f#1', ['b', 'a']));
  });

  it('shares one in-flight request between concurrent callers on the same network', () => {
    const cache = new RequestCache();
    let calls = 0;
    const invoke = (): Observable<string> => { calls++; return of('answer'); };

    const seen: string[] = [];
    cache.request('', listStatistics$ as never, 250, ['1w'], invoke).subscribe((v) => seen.push(v));
    cache.request('', listStatistics$ as never, 250, ['1w'], invoke).subscribe((v) => seen.push(v));

    expect(calls).toBe(1);
    expect(seen).toEqual(['answer', 'answer']);
  });

  it('does not answer one network with the other network\'s response', () => {
    const cache = new RequestCache();
    const answers: Record<string, string> = { '': 'mainnet-stats', '/signet': 'signet-stats' };
    const seen: string[] = [];

    for (const namespace of ['', '/signet', '']) {
      cache
        .request(namespace, listStatistics$ as never, 250, ['1w'], () => of(answers[namespace]))
        .subscribe((v) => seen.push(v));
    }

    expect(seen).toEqual(['mainnet-stats', 'signet-stats', 'mainnet-stats']);
  });

  it('separates the same call on two origins', () => {
    const cache = new RequestCache();
    const seen: string[] = [];
    cache.request('https://a.example|', listStatistics$ as never, 250, ['1w'], () => of('a')).subscribe((v) => seen.push(v));
    cache.request('https://b.example|', listStatistics$ as never, 250, ['1w'], () => of('b')).subscribe((v) => seen.push(v));
    expect(seen).toEqual(['a', 'b']);
  });

  it('separates different arguments to the same call', () => {
    const cache = new RequestCache();
    const seen: string[] = [];
    cache.request('', listStatistics$ as never, 250, ['1w'], () => of('week')).subscribe((v) => seen.push(v));
    cache.request('', listStatistics$ as never, 250, ['1m'], () => of('month')).subscribe((v) => seen.push(v));
    expect(seen).toEqual(['week', 'month']);
  });

  it('delivers the error to the callers waiting on it, then makes a fresh request on retry', () => {
    const cache = new RequestCache();
    let calls = 0;
    const failing = (): Observable<string> => { calls++; return throwError(() => new Error('upstream is down')); };

    const errors: string[] = [];
    cache.request('', listStatistics$ as never, 60_000, ['1w'], failing)
      .subscribe({ error: (e: Error) => errors.push(e.message) });
    expect(errors).toEqual(['upstream is down']);
    expect(calls).toBe(1);

    // The window has not passed. The old cache replayed the errored subject
    // here and never called the network again.
    const seen: string[] = [];
    cache.request('', listStatistics$ as never, 60_000, ['1w'], () => of('recovered'))
      .subscribe((v) => seen.push(v));

    expect(calls).toBe(1);
    expect(seen).toEqual(['recovered']);
  });

  it('does not let a failing request evict the entry that replaced it', () => {
    vi.useFakeTimers();
    try {
      const cache = new RequestCache();
      const first = new Subject<string>();
      const seen: string[] = [];

      // The first request is still open when its window passes and a second
      // request takes the key.
      cache.request('', listStatistics$ as never, 1_000, ['1w'], () => first)
        .subscribe({ next: () => undefined, error: () => undefined });
      vi.advanceTimersByTime(1_001);

      const replacement = new Subject<string>();
      cache.request('', listStatistics$ as never, 60_000, ['1w'], () => replacement)
        .subscribe({ next: (v) => seen.push(v), error: () => undefined });

      first.error(new Error('the old one failed'));

      // The replacement is still the live entry, so a third caller joins it
      // rather than starting a third request.
      let extraCalls = 0;
      cache.request('', listStatistics$ as never, 60_000, ['1w'], () => { extraCalls++; return of('unused'); })
        .subscribe({ next: (v) => seen.push(v), error: () => undefined });
      replacement.next('replacement answer');

      expect(extraCalls).toBe(0);
      expect(seen).toEqual(['replacement answer', 'replacement answer']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops entries whose window has passed rather than growing without bound', () => {
    vi.useFakeTimers();
    try {
      const cache = new RequestCache();
      cache.request('', listStatistics$ as never, 1_000, ['1w'], () => of('a')).subscribe();
      expect(cache.size).toBe(1);

      vi.advanceTimersByTime(1_001);

      // The next call sweeps first, so the expired entry is gone and this one
      // is a real request rather than a replay of the old answer.
      let calls = 0;
      cache.request('', listStatistics$ as never, 60_000, ['1w'], () => { calls++; return of('b'); }).subscribe();
      expect(calls).toBe(1);
      expect(cache.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
