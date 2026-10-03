import { Component, OnInit, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, merge, Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, switchMap, takeUntil, tap } from 'rxjs/operators';
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
    this.urlFragmentSubscription = this.route.fragment.subscribe((fragment) => {
      if (this.destroyed) { return; }
      this.fullRbf = (fragment === 'fullrbf');
      this.websocketService.startTrackRbf(this.fullRbf ? 'fullRbf' : 'all');
      this.isLoading = true;
      this.nextRbfSubject.next(null);
    });

    this.rbfTrees$ = merge(
      this.nextRbfSubject.pipe(
        switchMap(() => {
          this.isLoading = true; this.loadError = null;
          return this.apiService.getRbfList$(this.fullRbf).pipe(catchError(() => {
            this.isLoading = false; this.loadError = 'Replacement history is unavailable. Retry to load it.';
            return of([]);
          }));
        })
      ),
      this.stateService.rbfLatest$
    )
    .pipe(
      takeUntil(this.destroyed$),
      tap(() => {
        this.isLoading = false;
      })
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
