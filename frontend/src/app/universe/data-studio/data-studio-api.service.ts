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
  private selectedNetwork(): string {
    return this.state.network || this.state.env.ROOT_NETWORK || 'mainnet';
  }
  watchCatalog$(): Observable<any> {
    return this.state.networkChanged$.pipe(
      startWith(null),
      switchMap(() => {
        const network = this.selectedNetwork();
        return this.http.get<any>(this.prefix + '/api/v1/data/catalog').pipe(
          map((value) => {
            if (value?.source?.network !== network || !/^[a-f0-9]{64}$/.test(value?.snapshotId ?? '') ||
                !Array.isArray(value.datasets) || value.datasets.some((dataset: any) =>
                  dataset?.network !== network || dataset?.snapshotId !== value.snapshotId)) {
              throw Error('Owned catalogue does not match the selected network and snapshot.');
            }
            return { ...value, kind: 'ready' };
          }),
          catchError(() =>
            of({ kind: 'error', message: 'Owned Data Studio evidence is unavailable for this backend.' })
          ),
          startWith({ kind: 'loading' })
        );
      })
    );
  }
  query$(body: any) {
    const network = this.selectedNetwork(), snapshotId = body.snapshotId, datasetId = body.datasetId;
    return this.http.post<any>(this.prefix + '/api/v1/data/query', body).pipe(map(value => {
      if (value?.network !== network || value?.datasetId !== datasetId ||
          !/^[a-f0-9]{64}$/.test(value?.snapshotId ?? '') || (snapshotId !== undefined && value.snapshotId !== snapshotId)) {
        throw Error('Owned query response does not match the requested network, dataset and snapshot.');
      }
      return value;
    }));
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
      const network = this.selectedNetwork();
      events.onopen = () => subscriber.next({ kind: 'connected' });
      events.addEventListener('data.snapshot', (event: MessageEvent) => {
        try {
          const value = JSON.parse(event.data);
          if (value?.network !== network || !/^[a-f0-9]{64}$/.test(value?.snapshotId ?? '') ||
              !['snapshot', 'observation_gap'].includes(value?.kind) || typeof value?.id !== 'string' || !value.id ||
              !Number.isSafeInteger(value.sequence) || value.sequence < 1) {
            throw Error('Foreign or malformed snapshot event');
          }
          subscriber.next({ kind: 'event', event: value });
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
