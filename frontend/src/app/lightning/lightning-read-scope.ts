import { Observable, Subject, catchError, combineLatest, defer, finalize, of, shareReplay, startWith, switchMap, takeUntil, timeout } from 'rxjs';

/** One selected control/network scope, with bounded retryable read ownership. */
export function lightningReadScope<I, T>(control$: Observable<I>, network$: Observable<string>, retry$: Subject<void>, destroy$: Subject<void>,
  read: (input: I) => Observable<T>, reset: () => void, unavailable: () => void, finished: () => void): Observable<T> {
  return combineLatest([control$, network$, retry$.pipe(startWith(undefined))]).pipe(
    switchMap(([input]) => {
      reset();
      return defer(() => read(input)).pipe(timeout(15000), catchError(() => { unavailable(); return of(null); }),
        startWith(null), finalize(finished));
    }), takeUntil(destroy$), shareReplay({ bufferSize: 1, refCount: true }),
  );
}
