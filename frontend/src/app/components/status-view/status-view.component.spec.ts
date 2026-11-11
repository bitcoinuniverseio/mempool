import { describe, expect, it, vi } from 'vitest';
import { filter, firstValueFrom, of, throwError } from 'rxjs';
import { StatusViewComponent } from './status-view.component';
it('health outage terminates independently of the block stream and Retry recovers', async () => {
  const websocket = { want: vi.fn() };
  const api = { network: 'signet', getIndexerHealth$: vi.fn().mockReturnValueOnce(throwError(() => new Error('private host'))).mockReturnValue(of({ schemaVersion: 1, entries: [] })) };
  const view = new StatusViewComponent(websocket as never, api as never, 'server');
  view.ngOnInit();
  const states: any[] = [];
  const sub = view.health$.subscribe(value => states.push(value));
  expect(states.at(-1)).toMatchObject({ unavailable: true, loading: false });
  expect(JSON.stringify(states)).not.toContain('private host');
  expect(websocket.want).toHaveBeenCalledWith(['mempool-blocks', 'stats', 'blocks']);
  view.retry$.next();
  expect(states.at(-1)).toMatchObject({ unavailable: false, loading: false, rows: [] });
  sub.unsubscribe();
});
it('reports a hung health endpoint within six seconds and cancels on navigation', async () => {
  vi.useFakeTimers();
  try {
    const teardown = vi.fn();
    const { Observable } = await import('rxjs');
    const api = { network: 'signet', getIndexerHealth$: () => new Observable(() => teardown) };
    const view = new StatusViewComponent({ want: vi.fn() } as never, api as never, 'server');
    view.ngOnInit();
    const terminal = firstValueFrom(view.health$.pipe(filter(state => !state.loading)));
    await vi.advanceTimersByTimeAsync(6000);
    expect(await terminal).toMatchObject({ unavailable: true });
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
