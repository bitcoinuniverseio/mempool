import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';
import {
  Observable,
  catchError,
  combineLatest,
  defer,
  distinctUntilChanged,
  filter,
  map,
  of,
  startWith,
  switchMap,
  tap,
} from 'rxjs';
export interface AssetRouteContext<T> {
  readonly phase: 'ready' | 'pending' | 'unavailable';
  readonly value: T;
}
interface Boundary {
  readonly phase: AssetRouteContext<unknown>['phase'];
  readonly id: number;
}
/** Request values settle at NavigationEnd. StateService may publish scope at NavigationStart. */
export function assetRouteContext$<T>(
  values$: Observable<T>,
  router?: Router
): Observable<AssetRouteContext<T>> {
  let remembered: Boundary = {
    phase: 'ready',
    id: router?.lastSuccessfulNavigation?.id ?? 0,
  };
  const boundary$ = defer(() => {
    if (!router) {
      return of(remembered);
    }
    const active = router.getCurrentNavigation(),
      successful = router.lastSuccessfulNavigation;
    if (active && active.id >= remembered.id) {
      remembered = { phase: 'pending', id: active.id };
    } else if (successful && successful.id > remembered.id) {
      remembered = { phase: 'ready', id: successful.id };
    }
    return router.events.pipe(
      filter(
        (event) =>
          event instanceof NavigationStart ||
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError
      ),
      map((event) => {
        if (event instanceof NavigationStart && event.id >= remembered.id) {
          remembered = { phase: 'pending', id: event.id };
        } else if (event.id === remembered.id) {
          remembered = {
            phase: event instanceof NavigationEnd ? 'ready' : 'unavailable',
            id: event.id,
          };
        }
        return remembered;
      }),
      startWith(remembered)
    );
  });
  return combineLatest([values$, boundary$]).pipe(
    map(([value, boundary]) => {
      const active = router?.getCurrentNavigation();
      // The selected scope can emit synchronously from an earlier NavigationStart listener.
      const phase =
        active && active.id > boundary.id ? 'pending' : boundary.phase;
      return { phase, value };
    })
  );
}
/** One completed-context state slot, recreated by explicit retry; no request cache or polling. */
export function assetRouteState$<T, S extends { readonly kind: string }>(
  contexts$: Observable<AssetRouteContext<T>>,
  read: (value: T) => Observable<S>,
  pending: (value: T) => S,
  unavailable: (value: T) => S,
  equal: (a: T, b: T) => boolean,
  restore: (state: S, value: T) => Observable<S> = (state) => of(state)
): Observable<S> {
  let completed: { value: T; state: S } | undefined;
  return contexts$.pipe(
    distinctUntilChanged(
      (a, b) => a.phase === b.phase && equal(a.value, b.value)
    ),
    switchMap((context) => {
      if (completed && !equal(completed.value, context.value)) {
        completed = undefined;
      }
      if (context.phase === 'pending') {
        return of(pending(context.value));
      }
      if (context.phase === 'unavailable') {
        completed = undefined;
        return of(unavailable(context.value));
      }
      const previous = completed;
      const result =
        previous && equal(previous.value, context.value)
          ? defer(() => restore(previous.state, context.value))
          : defer(() => read(context.value));
      return result.pipe(
        catchError(() => of(unavailable(context.value))),
        tap((state) => {
          if (state.kind === 'ready') {
            completed = { value: context.value, state };
          } else if (state.kind !== 'loading') {
            completed = undefined;
          }
        })
      );
    })
  );
}
