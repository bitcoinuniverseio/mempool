import { ChainHealthService } from '../chain-health.service';
import { Injectable } from '@angular/core';
import {
  Observable,
  auditTime,
  catchError,
  map,
  merge,
  of,
  scan,
  shareReplay,
  switchMap,
  timer,
} from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { isChainNetworkUnavailable } from '@app/universe/chain-network';
import { UniverseWebsocketService } from '@app/universe/universe-websocket.service';
import {
  ChainCapabilityEnvelope,
  ChainDashboardView,
  ChainExplorerPayload,
  ExplorerChain,
} from '@app/universe/universe.types';

/**
 * 'dashboard-unavailable' is the source failing to answer; 'network-not-offered'
 * is the overlay's typed refusal (`<chain>-network-unavailable`) because the
 * dashboard, mining and fee statistics are offered for mainnet only and the
 * frontend is bound to another network of the chain. The two must never be
 * rendered as the same thing: the second is not an outage.
 */
export type ChainDashboardError = 'dashboard-unavailable' | 'network-not-offered' | 'network-config-invalid';

export interface ChainDashboardState {
  readonly view: ChainDashboardView | null;
  readonly error: ChainDashboardError | null;
  /** True when the view is the retained last-good one after a failed refresh. */
  readonly stale?: boolean;
}

export interface ChainPendingState {
  readonly payload: ChainExplorerPayload | null;
  readonly error: string | null;
  readonly stale?: boolean;
}

/** The overlay's typed refusal for a scope the statistics are not offered on. */
export function isNetworkNotOffered(failure: unknown): boolean {
  const body = (failure as { error?: unknown } | null)?.error;
  const message = typeof body === 'string' ? body : (body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && /-network-unavailable$/.test(message);
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


  constructor(
    private readonly api: UniverseApiService,
    private readonly live: UniverseWebsocketService,
    private readonly health: ChainHealthService
  ) {}

  dashboard$(
    chain: Exclude<ExplorerChain, 'bitcoin'>
  ): Observable<ChainDashboardState> {
    let stream = this.dashboards.get(chain);
    if (!stream) {
      stream = this.refreshing$(chain, () =>
        this.api.getChainDashboard$(chain).pipe(
          map((view): ChainDashboardState => ({ view, error: null, stale: false })),
          catchError((failure: unknown) =>
            of<ChainDashboardState>({
              view: null,
              error: isChainNetworkUnavailable(failure) ? 'network-config-invalid'
                : isNetworkNotOffered(failure) ? 'network-not-offered' : 'dashboard-unavailable',
              stale: true,
            })
          )
        )
      ).pipe(
        // Keep the last good view through a failed poll, marked stale, so
        // the page keeps its evidence and its observation time instead of
        // going blank.
        scan((previous: ChainDashboardState, next: ChainDashboardState): ChainDashboardState =>
          next.error && previous.view ? { ...next, view: previous.view } : next,
        { view: null, error: null }),
      );
      this.dashboards.set(chain, stream);
    }
    return stream;
  }

  capability$(
    chain: Exclude<ExplorerChain, 'bitcoin'>
  ): Observable<ChainCapabilityEnvelope | null> {
    return this.health.capability$(chain);
  }

  pending$(
    chain: Exclude<ExplorerChain, 'bitcoin'>
  ): Observable<ChainPendingState> {
    let stream = this.pending.get(chain);
    if (!stream) {
      stream = this.refreshing$(chain, () =>
        this.api.getChainMempool$(chain, 400).pipe(
          map((payload): ChainPendingState => ({ payload, error: null, stale: false })),
          catchError(() =>
            of<ChainPendingState>({
              payload: null,
              error: 'mempool-unavailable',
              stale: true,
            })
          )
        )
      ).pipe(
        scan((previous: ChainPendingState, next: ChainPendingState): ChainPendingState =>
          next.error && previous.payload ? { ...next, payload: previous.payload } : next,
        { payload: null, error: null }),
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
