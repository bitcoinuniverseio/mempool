import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject, catchError, map, of, startWith, switchMap, timer, timeout, take } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { INDEXER_STATE_LABEL, indexerViewState, scopedIndexerEntries } from '@app/universe/indexer-health';
import { WebsocketService } from '@app/services/websocket.service';

@Component({
  selector: 'app-status-view',
  templateUrl: './status-view.component.html',
  standalone: false,
})
export class StatusViewComponent implements OnInit {
  readonly retry$ = new Subject<void>();
  health$: Observable<{ loading: boolean; unavailable: boolean; rows: { protocol: string; state: string; height: number | null }[] }>;

  constructor(
    private websocketService: WebsocketService,
    private universeApi: UniverseApiService,
    @Inject(PLATFORM_ID) private platformId: object,
  ) { }

  ngOnInit() {
    this.websocketService.want(['mempool-blocks', 'stats', 'blocks']);
    this.health$ = this.retry$.pipe(startWith(undefined), switchMap(() => (isPlatformBrowser(this.platformId) ? timer(0, 15_000) : of(0)).pipe(
      switchMap(() => this.universeApi.getIndexerHealth$().pipe(
        take(1),
        timeout({ first: 6000 }),
        map(body => ({ loading: false, unavailable: false, rows: scopedIndexerEntries(body, this.universeApi.network).map(entry => ({
          protocol: entry.protocolId!, state: INDEXER_STATE_LABEL[indexerViewState(entry)],
          height: typeof entry.indexedHeight === 'number' ? entry.indexedHeight : null,
        })) })),
        catchError(() => of({ loading: false, unavailable: true, rows: [] })),
      )),
      startWith({ loading: true, unavailable: false, rows: [] }),
    )));

  }
}
