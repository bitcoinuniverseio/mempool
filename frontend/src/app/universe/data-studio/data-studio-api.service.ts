import { Inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { Observable, of } from 'rxjs';
import { startWith, switchMap, map, catchError } from 'rxjs/operators';
@Injectable({ providedIn: 'root' })
export class DataStudioApiService {
  constructor(
    @Inject(HttpClient) private http: HttpClient,
    @Inject(StateService) private state: StateService
  ) {}
  private get prefix() {
    const network = this.state.network ?? '';
    return (
      (this.state.isBrowser
        ? ''
        : `${this.state.env.NGINX_PROTOCOL}://${this.state.env.NGINX_HOSTNAME}:${this.state.env.NGINX_PORT}`) +
      (network && network !== (this.state.env.ROOT_NETWORK ?? 'mainnet') ? '/' + network : '')
    );
  }
  watchCatalog$(): Observable<any> {
    return this.state.networkChanged$.pipe(
      startWith(null),
      switchMap(() =>
        this.http.get<any>(this.prefix + '/api/v1/data/catalog').pipe(
          map((value) => ({ kind: 'ready', ...value })),
          catchError(() =>
            of({ kind: 'error', message: 'Owned Data Studio evidence is unavailable for this backend.' })
          ),
          startWith({ kind: 'loading' })
        )
      )
    );
  }
  query$(body: any) {
    return this.http.post<any>(this.prefix + '/api/v1/data/query', body);
  }
  exportUrl(id: string, dataset: string, format: string) {
    return (
      this.prefix +
      '/api/v1/data/export/' +
      encodeURIComponent(id) +
      '/' +
      encodeURIComponent(dataset) +
      '?format=' +
      encodeURIComponent(format)
    );
  }
  stream$(): Observable<any> {
    return new Observable((subscriber) => {
      if (typeof EventSource === 'undefined') {
        subscriber.error(Error('Browser SSE unavailable'));
        return;
      }
      const events = new EventSource(this.prefix + '/api/v1/data/live/snapshots');
      events.onopen = () => subscriber.next({ kind: 'connected' });
      events.addEventListener('data.snapshot', (event: MessageEvent) => {
        try {
          subscriber.next({ kind: 'event', event: JSON.parse(event.data) });
        } catch {
          subscriber.error(Error('Invalid stream data'));
        }
      });
      events.addEventListener('data.source-unavailable', () => subscriber.error(Error('Owned source refresh failed.')));
      events.onerror = () =>
        subscriber.next({
          kind: 'disconnected',
          message: 'Stream disconnected; browser is attempting to resume within retained event coverage.',
        });
      return () => events.close();
    });
  }
}
