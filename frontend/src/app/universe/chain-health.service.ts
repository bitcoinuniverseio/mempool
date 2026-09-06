import { Injectable } from '@angular/core';
import { Observable, Subject, catchError, defer, distinctUntilChanged, map, merge, of, shareReplay, startWith, switchMap, take, timer } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from './universe-api.service';
import { ChainCapabilityEnvelope, ExplorerChain } from './universe.types';

export interface ChainHealthState {
  capabilities: ChainCapabilityEnvelope[];
  loading: boolean;
  error: string | null;
}

/** A single health poll shared by the picker, dashboards, details and sync notice. */
@Injectable({ providedIn: 'root' })
export class ChainHealthService {
  private readonly refresh$ = new Subject<void>();
  readonly state$: Observable<ChainHealthState>;

  constructor(private api: UniverseApiService, state: StateService) {
    const loading: ChainHealthState = { capabilities: [], loading: true, error: null };
    this.state$ = !state.isBrowser ? of(loading) : defer(() => (state.networkChanged$ ?? of(state.network)).pipe(
      startWith(state.network),
      map(() => state.network || 'mainnet'),
      distinctUntilChanged(),
      // Clear the previous partition immediately, including its pending request.
      switchMap(() => merge(timer(0, 15_000), this.refresh$).pipe(
        switchMap(() => this.api.getChains$().pipe(
          take(1),
          map(capabilities => ({ capabilities, loading: false, error: null } as ChainHealthState)),
          catchError(() => of<ChainHealthState>({ capabilities: [], loading: false, error: 'Status refresh failed. Current health is unknown.' })),
        )),
        startWith(loading),
      )),
    )).pipe(shareReplay({ bufferSize: 1, refCount: true }));
  }

  capability$(chain: ExplorerChain): Observable<ChainCapabilityEnvelope | null> {
    return this.state$.pipe(map(state => state.capabilities.find(row => row.chain === chain) ?? null));
  }

  retry(): void {this.refresh$.next();}
}
