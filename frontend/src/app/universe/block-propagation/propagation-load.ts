import { Observable, Subscription, catchError, defer, map, of, startWith, switchMap } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';

export interface PropagationLoad<T> { loading: boolean; value: T | null; error: string | null; }

export function watchPropagation<K, T>(trigger: Observable<K>, read: (key: K) => Observable<T>, update: (state: PropagationLoad<T>) => void): Subscription {
  return trigger.pipe(switchMap(key => defer(() => read(key)).pipe(
    map(value => ({ loading: false, value, error: null })),
    catchError(error => of({ loading: false, value: null, error: loadFailureMessage(classifyLoadFailure(error)) })),
    startWith({ loading: true, value: null, error: null }),
  ))).subscribe(update);
}
