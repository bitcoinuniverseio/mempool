import { describe, it, expect } from 'vitest';
import {
  NavigationStart,
  NavigationEnd,
  NavigationCancel,
  NavigationError,
  Router,
} from '@angular/router';
import { BehaviorSubject, Subject, Observable, of } from 'rxjs';
import { assetRouteContext$, assetRouteState$ } from './asset-route-context';
function setup(): {
  router: Router;
  events: Subject<unknown>;
  values: BehaviorSubject<string>;
  active: { id: number } | null;
  successful: { id: number } | null;
  contexts: Observable<
    import('./asset-route-context').AssetRouteContext<string>
  >;
} {
  const events = new Subject<unknown>(),
    values = new BehaviorSubject('a');
  const state = {
    router: null as unknown as Router,
    events,
    values,
    active: null as { id: number } | null,
    successful: null as { id: number } | null,
    contexts: null as unknown as Observable<
      import('./asset-route-context').AssetRouteContext<string>
    >,
  };
  state.router = {
    events,
    getCurrentNavigation: () => state.active,
    get lastSuccessfulNavigation() {
      return state.successful;
    },
  } as never;
  state.contexts = assetRouteContext$(values, state.router);
  return state;
}
describe('bounded Router asset read coordination', () => {
  it('duplicate settled values produce one attempt even before first result, destruction cancels', () => {
    const f = setup(),
      reads: Subject<{ kind: string }>[] = [];
    const sub = assetRouteState$(
      f.contexts,
      () => {
        const request = new Subject<{ kind: string }>();
        reads.push(request);
        return request;
      },
      () => ({ kind: 'loading' }),
      () => ({ kind: 'unavailable' }),
      (a, b) => a === b
    ).subscribe();
    f.values.next('a');
    f.values.next('a');
    expect(reads).toHaveLength(1);
    sub.unsubscribe();
    expect(reads[0].observed).toBe(false);
    expect(f.events.observed).toBe(false);
  });
  it('early scope values cancel before our NavigationStart listener and only latest end reads', () => {
    const f = setup(),
      reads: Subject<{ kind: string }>[] = [];
    const states: string[] = [];
    const sub = assetRouteState$(
      f.contexts,
      () => {
        const r = new Subject<{ kind: string }>();
        reads.push(r);
        return r;
      },
      () => ({ kind: 'loading' }),
      () => ({ kind: 'unavailable' }),
      (a, b) => a === b
    ).subscribe((s) => states.push(s.kind));
    f.active = { id: 1 };
    f.values.next('b');
    expect(reads[0].observed).toBe(false);
    expect(states.at(-1)).toBe('loading');
    f.events.next(new NavigationStart(1, '/b'));
    f.active = { id: 2 };
    f.events.next(new NavigationStart(2, '/c'));
    f.values.next('c');
    f.events.next(new NavigationEnd(1, '/b', '/b'));
    expect(reads).toHaveLength(1);
    f.events.next(new NavigationEnd(2, '/c', '/c'));
    expect(reads).toHaveLength(2);
    sub.unsubscribe();
  });
  it('initial active navigation waits even when its id equals last successful; matching end restores gate', () => {
    const f = setup();
    f.active = { id: 2 };
    f.successful = { id: 2 };
    const values: string[] = [];
    const sub = f.contexts.subscribe((c) => values.push(c.phase));
    expect(values.at(-1)).toBe('pending');
    f.events.next(new NavigationEnd(2, '/a', '/a'));
    expect(values.at(-1)).toBe('ready');
    sub.unsubscribe();
  });
  it('cancel and error persist across retry subscription until a new successful navigation', () => {
    for (const event of [
      new NavigationCancel(1, '/b', 'controlled'),
      new NavigationError(1, '/b', Error('controlled')),
    ]) {
      const f = setup();
      const first = f.contexts.subscribe();
      f.active = { id: 1 };
      f.events.next(new NavigationStart(1, '/b'));
      f.events.next(event);
      f.active = null;
      first.unsubscribe();
      const phases: string[] = [];
      const next = f.contexts.subscribe((c) => phases.push(c.phase));
      expect(phases.at(-1)).toBe('unavailable');
      f.active = { id: 2 };
      f.events.next(new NavigationStart(2, '/a'));
      f.events.next(new NavigationEnd(2, '/a', '/a'));
      expect(phases.at(-1)).toBe('ready');
      next.unsubscribe();
    }
  });
  it('only completed ready retains; loading, misses and failures restart after completed navigation', () => {
    for (const kind of ['loading', 'unavailable', 'missing', 'invalid']) {
      const f = setup();
      let reads = 0;
      const sub = assetRouteState$(
        f.contexts,
        () => {
          reads++;
          return of({ kind });
        },
        () => ({ kind: 'loading' }),
        () => ({ kind: 'unavailable' }),
        (a, b) => a === b
      ).subscribe();
      f.active = { id: 1 };
      f.events.next(new NavigationStart(1, '/a'));
      f.events.next(new NavigationEnd(1, '/a', '/a'));
      expect(reads).toBe(2);
      sub.unsubscribe();
    }
  });
  it('completed identical context restores without read; changed semantic context invalidates even while pending', () => {
    const f = setup();
    let reads = 0;
    const sub = assetRouteState$(
      f.contexts,
      () => {
        reads++;
        return of({ kind: 'ready' });
      },
      () => ({ kind: 'loading' }),
      () => ({ kind: 'unavailable' }),
      (a, b) => a === b
    ).subscribe();
    f.active = { id: 1 };
    f.events.next(new NavigationStart(1, '/a'));
    f.events.next(new NavigationEnd(1, '/a', '/a'));
    expect(reads).toBe(1);
    f.active = { id: 2 };
    f.events.next(new NavigationStart(2, '/b'));
    f.values.next('b');
    f.active = { id: 3 };
    f.events.next(new NavigationStart(3, '/a'));
    f.values.next('a');
    f.events.next(new NavigationEnd(3, '/a', '/a'));
    expect(reads).toBe(2);
    sub.unsubscribe();
  });
});
