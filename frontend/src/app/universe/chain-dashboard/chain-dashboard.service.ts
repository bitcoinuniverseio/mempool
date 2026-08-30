import { Injectable } from '@angular/core';
import {
  Observable,
  auditTime,
  catchError,
  map,
  merge,
  of,
  shareReplay,
  switchMap,
  timer,
} from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseWebsocketService } from '@app/universe/universe-websocket.service';
import {
  ChainCapabilityEnvelope,
  ChainDashboardView,
  ChainExplorerPayload,
  ExplorerChain,
} from '@app/universe/universe.types';

export interface ChainDashboardState {
  readonly view: ChainDashboardView | null;
  readonly error: string | null;
}

export interface ChainPendingState {
  readonly payload: ChainExplorerPayload | null;
  readonly error: string | null;
}

/** How often the page re-reads when no live event arrives first. */
const POLL_MS = 15_000;

/**
 * One data feed per chain, shared by every widget on the page. The
 * dashboard, the timeline, the fee panel, and the lens all subscribe to
 * the same replayed stream, so adding a widget never adds a polling loop.
 * A live websocket event refreshes the same request the timer would have.
 */
@Injectable({ providedIn: 'root' })
export class ChainDashboardService {
  private readonly dashboards = new Map<string, Observable<ChainDashboardState>>();
  private readonly pending = new Map<string, Observable<ChainPendingState>>();
  private readonly capabilities = new Map<
    string,
    Observable<ChainCapabilityEnvelope | null>
  >();

  constructor(
    private readonly api: UniverseApiService,
    private readonly live: UniverseWebsocketService
  ) {}

  dashboard$(
    chain: Exclude<ExplorerChain, 'bitcoin'>
  ): Observable<ChainDashboardState> {
    let stream = this.dashboards.get(chain);
    if (!stream) {
      stream = this.refreshing$(chain, () =>
        this.api.getChainDashboard$(chain).pipe(
          map((view): ChainDashboardState => ({ view, error: null })),
          catchError(() =>
            of<ChainDashboardState>({
              view: null,
              error: 'dashboard-unavailable',
            })
          )
        )
      );
      this.dashboards.set(chain, stream);
    }
    return stream;
  }

  capability$(
    chain: Exclude<ExplorerChain, 'bitcoin'>
  ): Observable<ChainCapabilityEnvelope | null> {
    let stream = this.capabilities.get(chain);
    if (!stream) {
      stream = this.refreshing$(chain, () =>
        this.api.getChainStatus$(chain).pipe(
          catchError(() => of<ChainCapabilityEnvelope | null>(null))
        )
      );
      this.capabilities.set(chain, stream);
    }
    return stream;
  }

  pending$(
    chain: Exclude<ExplorerChain, 'bitcoin'>
  ): Observable<ChainPendingState> {
    let stream = this.pending.get(chain);
    if (!stream) {
      stream = this.refreshing$(chain, () =>
        this.api.getChainMempool$(chain, 400).pipe(
          map((payload): ChainPendingState => ({ payload, error: null })),
          catchError(() =>
            of<ChainPendingState>({
              payload: null,
              error: 'mempool-unavailable',
            })
          )
        )
      );
      this.pending.set(chain, stream);
    }
    return stream;
  }

  private refreshing$<T>(
    chain: Exclude<ExplorerChain, 'bitcoin'>,
    request: () => Observable<T>
  ): Observable<T> {
    return merge(timer(0, POLL_MS), this.live.stream$(chain)).pipe(
      auditTime(150),
      switchMap(() => request()),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }
}
