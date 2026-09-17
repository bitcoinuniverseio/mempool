import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subject, Subscription, catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

import {
  BlockTemplateComparison,
  ObserverNode,
  PropagationObservation,
} from '@app/universe/universe.types';

/**
 * unavailable: the owned node observation behind every read is down (503
 * owned-node-unavailable or another 5xx) and a retry can help; error: any
 * other failure, including a route this deployment does not serve.
 */
interface NetworkViewModel {
  readonly kind: 'loading' | 'ready' | 'unavailable' | 'error';
  readonly nodes?: ObserverNode[];
  readonly propagation?: PropagationObservation;
  readonly templates?: BlockTemplateComparison;
  readonly message?: string;
  /** The backend's typed reason, for example owned-node-unavailable. */
  readonly stage?: string;
}

@Component({
  selector: 'app-network-observatory',
  templateUrl: './network-observatory.component.html',
  styleUrls: ['../product-page.scss', './network-observatory.component.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkObservatoryComponent implements OnInit, OnDestroy {
  private readonly state = new BehaviorSubject<NetworkViewModel>({ kind: 'loading' });
  private readonly retry$ = new Subject<void>();
  private subscription?: Subscription;
  readonly vm$: Observable<NetworkViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Cross-Node Mempool & Template Observatory');
  }

  ngOnInit(): void {
    // No per-read fallback: a fleet table the source could not answer is an
    // error with its reason, not an empty table under a live-looking timeline.
    // Retry re-runs all three reads; a click while one attempt is in flight
    // cancels it.
    this.subscription = this.retry$.pipe(
      startWith(undefined),
      switchMap(() => combineLatest([
        this.api.getObserverNodes$(),
        this.api.getPropagationObservation$(),
        this.api.getBlockTemplateComparison$(),
      ]).pipe(
        map(([nodesData, propagation, templates]): NetworkViewModel => ({
          kind: 'ready',
          nodes: nodesData.nodes,
          propagation,
          templates,
        })),
        catchError((error) => of(this.failure(error))),
        startWith<NetworkViewModel>({ kind: 'loading' }),
      )),
    ).subscribe((vm) => this.state.next(vm));
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  retry(): void {
    this.retry$.next();
  }

  private failure(error: any): NetworkViewModel {
    const reason = classifyLoadFailure(error);
    const stage = typeof error?.error?.stage === 'string' ? error.error.stage : undefined;
    const message = typeof error?.error?.error === 'string' ? error.error.error : loadFailureMessage(reason);
    return { kind: reason === 'unavailable' || reason === 'timeout' || reason === 'network' ? 'unavailable' : 'error', message, stage };
  }

  /** A value one local observer did not measure is shown as exactly that. */
  measured(value: number | null | undefined, unit: string): string {
    return value === null || value === undefined ? 'not measured' : `${value} ${unit}`;
  }
}
