import { Component, OnInit, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, combineLatest, merge, Observable, Subject, Subscription } from 'rxjs';
import { distinctUntilChanged, filter, map, shareReplay, startWith, switchMap, takeUntil, tap } from 'rxjs/operators';
import { RbfReadState, rbfRead$, validRbfList } from '@app/services/rbf-history-state';
import { WebsocketService } from '@app/services/websocket.service';
import { RbfTree } from '@interfaces/node-api.interface';
import { ApiService } from '@app/services/api.service';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { OpenGraphService } from '@app/services/opengraph.service';
import { seoDescriptionNetwork } from '@app/shared/common.utils';

@Component({
  selector: 'app-rbf-list',
  templateUrl: './rbf-list.component.html',
  styleUrls: ['./rbf-list.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RbfList implements OnInit, OnDestroy {
  rbfTrees$: Observable<RbfTree[]>;
  nextRbfSubject = new BehaviorSubject(null);
  urlFragmentSubscription: Subscription;
  fullRbf: boolean;
  isLoading = true;
  loadError: string | null = null;
  private destroyed = false;
  private readonly destroyed$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private apiService: ApiService,
    public stateService: StateService,
    private websocketService: WebsocketService,
    private seoService: SeoService,
    private ogService: OpenGraphService,
  ) { }

  ngOnInit(): void {
    this.rbfTrees$ = combineLatest([
      this.route.fragment.pipe(map(fragment => fragment === 'fullrbf'), distinctUntilChanged()),
      this.stateService.networkChanged$.pipe(startWith(this.stateService.network), distinctUntilChanged()),
    ]).pipe(
      tap(([fullRbf]) => { this.fullRbf = fullRbf; this.websocketService.startTrackRbf(fullRbf ? 'fullRbf' : 'all'); }),
      switchMap(([fullRbf, network]) => merge(
        this.nextRbfSubject.pipe(switchMap(() => rbfRead$(() => this.apiService.getRbfList$(fullRbf), validRbfList))),
        this.stateService.rbfLatest$.pipe(map(value => ({ status: 'ready', value } as RbfReadState<RbfTree[]>))),
        this.stateService.rbfHistoryAvailability$.pipe(filter(status => status === 'unavailable'), map(() => ({ status: 'unavailable' } as RbfReadState<RbfTree[]>))),
      ).pipe(
        filter(() => network === this.stateService.network),
        map(state => state.status === 'ready' && (!validRbfList(state.value) || !this.stateService.rbfHistoryState.canUseHistory()) ? { status: 'unavailable' } as RbfReadState<RbfTree[]> : state),
      )),
      takeUntil(this.destroyed$),
      tap(state => {
        this.isLoading = state.status === 'loading';
        this.loadError = state.status === 'unavailable' ? 'Replacement history is unavailable. Retry to load it.' : null;
      }),
      map(state => state.status === 'ready' ? state.value : []),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.seoService.setTitle($localize`:@@5e3d5a82750902f159122fcca487b07f1af3141f:RBF Replacements`);
    this.seoService.setDescription($localize`:@@meta.description.rbf-list:See the most recent RBF replacements on the Bitcoin${seoDescriptionNetwork(this.stateService.network)} network, updated in real-time.`);
  }

  retryLoad(): void {
    if (!this.destroyed) { this.nextRbfSubject.next(null); }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.destroyed$.next(); this.destroyed$.complete();
    this.urlFragmentSubscription?.unsubscribe();
    this.websocketService.stopTrackRbf();
  }
}
