import { describe, expect, it } from 'vitest';
import { Subject, firstValueFrom, toArray } from 'rxjs';
import { ChainHealthState } from './chain-health.service';
import { mainReady } from './main-ready';

const loading: ChainHealthState = { capabilities: [], loading: true, error: null };
const settled: ChainHealthState = { capabilities: [], loading: false, error: null };
const failed: ChainHealthState = { capabilities: [], loading: false, error: 'Status refresh failed. Current health is unknown.' };

describe('mainReady', () => {
  it('holds the route until the first health reading has settled', async () => {
    const state$ = new Subject<ChainHealthState>();
    const seen: boolean[] = [];
    const done = firstValueFrom(mainReady(state$, true, 60_000).pipe(toArray()));
    expect(seen).toEqual([]);
    state$.next(loading);
    state$.next(settled);
    expect(await done).toEqual([false, true]);
  });

  it('treats a failed reading as a reading: the notice knows what to say', async () => {
    const state$ = new Subject<ChainHealthState>();
    const done = firstValueFrom(mainReady(state$, true, 60_000).pipe(toArray()));
    state$.next(failed);
    expect(await done).toEqual([false, true]);
  });

  it('renders anyway once the cap has passed without a reading', async () => {
    const state$ = new Subject<ChainHealthState>();
    const started = Date.now();
    const values = await firstValueFrom(mainReady(state$, true, 40).pipe(toArray()));
    expect(values).toEqual([false, true]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });

  it('does not wait outside a browser', async () => {
    const state$ = new Subject<ChainHealthState>();
    expect(await firstValueFrom(mainReady(state$, false).pipe(toArray()))).toEqual([true]);
  });
});
