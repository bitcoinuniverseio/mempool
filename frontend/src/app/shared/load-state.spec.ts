import { describe, it, expect } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, firstValueFrom, of, throwError, timer } from 'rxjs';
import { map, toArray } from 'rxjs/operators';
import {
  classifyLoadFailure,
  isRetryableFailure,
  toLoadState,
  trackedLoadState,
  type LoadState,
} from './load-state';

/**
 * The failure this suite exists to prevent: a request that never resolves,
 * leaving a spinner or a skeleton on screen with nothing subscribed to clear
 * it. Every case below asserts that a terminal state is reached.
 */

function statuses<T>(states: LoadState<T>[]): string[] {
  return states.map((state) => state.status);
}

async function collect<T>(source: ReturnType<typeof toLoadState<T>>): Promise<LoadState<T>[]> {
  return firstValueFrom(source.pipe(toArray()));
}

const noRetry = { retries: 0 };

describe('classifyLoadFailure', () => {
  it('calls a 404 missing, because this deployment does not serve the route', () => {
    expect(classifyLoadFailure(new HttpErrorResponse({ status: 404 }))).toBe('missing');
  });

  it('calls a 500 unavailable, because the dependency behind it is down', () => {
    expect(classifyLoadFailure(new HttpErrorResponse({ status: 500 }))).toBe('unavailable');
  });

  it('calls status zero a network failure', () => {
    expect(classifyLoadFailure(new HttpErrorResponse({ status: 0 }))).toBe('network');
  });

  it('calls a 403 missing, so it is never retried', () => {
    expect(classifyLoadFailure(new HttpErrorResponse({ status: 403 }))).toBe('missing');
  });
});

describe('isRetryableFailure', () => {
  it('retries what a retry could fix', () => {
    expect(isRetryableFailure('timeout')).toBe(true);
    expect(isRetryableFailure('unavailable')).toBe(true);
    expect(isRetryableFailure('network')).toBe(true);
  });

  it('does not retry a route this deployment does not serve', () => {
    expect(isRetryableFailure('missing')).toBe(false);
    expect(isRetryableFailure('malformed')).toBe(false);
  });
});

describe('toLoadState', () => {
  it('reaches data when the request succeeds', async () => {
    const states = await collect(toLoadState(of([1, 2, 3]), noRetry));
    expect(statuses(states)).toEqual(['loading', 'data']);
    expect(states[1]).toMatchObject({ status: 'data', value: [1, 2, 3] });
  });

  it('separates a valid empty answer from a failure', async () => {
    const states = await collect(toLoadState(of([]), noRetry));
    expect(statuses(states)).toEqual(['loading', 'empty']);
  });

  it('reaches error on a 404 rather than staying loading', async () => {
    const states = await collect(
      toLoadState(throwError(() => new HttpErrorResponse({ status: 404 })), noRetry),
    );
    expect(statuses(states)).toEqual(['loading', 'error']);
    expect(states[1]).toMatchObject({ status: 'error', reason: 'missing' });
  });

  it('reaches error on a 500', async () => {
    const states = await collect(
      toLoadState(throwError(() => new HttpErrorResponse({ status: 500 })), noRetry),
    );
    expect(states[1]).toMatchObject({ status: 'error', reason: 'unavailable' });
  });

  it('reaches error on a network failure', async () => {
    const states = await collect(
      toLoadState(throwError(() => new HttpErrorResponse({ status: 0 })), noRetry),
    );
    expect(states[1]).toMatchObject({ status: 'error', reason: 'network' });
  });

  it('gives up on a request that hangs, instead of loading forever', async () => {
    const never = new Subject<number[]>();
    const states = await collect(toLoadState(never, { timeoutMs: 40, ...noRetry }));
    expect(statuses(states)).toEqual(['loading', 'error']);
    expect(states[1]).toMatchObject({ reason: 'timeout' });
  });

  it('treats a null body as malformed rather than as data', async () => {
    const states = await collect(toLoadState(of(null as unknown as number[]), noRetry));
    expect(states[1]).toMatchObject({ status: 'error', reason: 'malformed' });
  });

  it('keeps a previous good answer on screen, labelled stale, when a later read fails', async () => {
    const states = await collect(
      toLoadState(
        throwError(() => new HttpErrorResponse({ status: 500 })),
        noRetry,
        { value: [7], at: 1000 },
      ),
    );
    expect(statuses(states)).toEqual(['loading', 'stale']);
    expect(states[1]).toMatchObject({ status: 'stale', value: [7], at: 1000, reason: 'unavailable' });
  });

  it('retries a retryable failure and reports the recovered answer', async () => {
    let attempts = 0;
    const flaky = timer(0).pipe(
      map(() => {
        attempts += 1;
        if (attempts < 3) throw new HttpErrorResponse({ status: 503 });
        return [attempts];
      }),
    );
    const states = await collect(toLoadState(flaky, { retries: 3, retryDelayMs: 1 }));
    expect(statuses(states)).toEqual(['loading', 'data']);
    expect(attempts).toBe(3);
  });

  it('does not retry a 404, however many retries are allowed', async () => {
    let attempts = 0;
    const missing = timer(0).pipe(
      map(() => {
        attempts += 1;
        throw new HttpErrorResponse({ status: 404 });
      }),
    );
    const states = await collect(toLoadState(missing, { retries: 5, retryDelayMs: 1 }));
    expect(statuses(states)).toEqual(['loading', 'error']);
    expect(attempts).toBe(1);
  });

  it('honours a custom emptiness test', async () => {
    const states = await collect(
      toLoadState(of({ rows: [] }), { ...noRetry, isEmpty: (value) => value.rows.length === 0 }),
    );
    expect(statuses(states)).toEqual(['loading', 'empty']);
  });
});

describe('trackedLoadState', () => {
  it('emits a loading state for each new key', async () => {
    const trigger = new Subject<string>();
    const seen: LoadState<number[]>[] = [];
    const subscription = trackedLoadState(trigger, (key) => of([key.length]), noRetry).subscribe((state) =>
      seen.push(state),
    );
    trigger.next('2h');
    trigger.next('24h');
    subscription.unsubscribe();
    expect(statuses(seen)).toEqual(['loading', 'data', 'loading', 'data']);
  });

  it('does not carry a previous range answer into a different range', async () => {
    const trigger = new Subject<string>();
    const seen: LoadState<number[]>[] = [];
    const subscription = trackedLoadState(
      trigger,
      (key) => (key === '2h' ? of([1]) : throwError(() => new HttpErrorResponse({ status: 500 }))),
      noRetry,
    ).subscribe((state) => seen.push(state));
    trigger.next('2h');
    trigger.next('24h');
    subscription.unsubscribe();
    // The 24h failure must not show 2h numbers under a stale label.
    expect(statuses(seen)).toEqual(['loading', 'data', 'loading', 'error']);
  });

  it('stops emitting once unsubscribed, so a destroyed component cannot be updated', async () => {
    const trigger = new Subject<string>();
    const seen: LoadState<number[]>[] = [];
    const subscription = trackedLoadState(trigger, () => of([1]), noRetry).subscribe((state) => seen.push(state));
    trigger.next('2h');
    subscription.unsubscribe();
    trigger.next('24h');
    expect(seen.length).toBe(2);
  });
});
