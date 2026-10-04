import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Observable, Subject, catchError, defer, finalize, merge, of, shareReplay, startWith, switchMap, takeUntil, timeout } from 'rxjs';
import { INodesRanking, INodesStatistics } from '@interfaces/node-api.interface';
import { SeoService } from '@app/services/seo.service';
import { OpenGraphService } from '@app/services/opengraph.service';
import { StateService } from '@app/services/state.service';
import { LightningApiService } from '@app/lightning/lightning-api.service';

@Component({
  selector: 'app-lightning-dashboard',
  templateUrl: './lightning-dashboard.component.html',
  styleUrls: ['./lightning-dashboard.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LightningDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  statistics$: Observable<INodesStatistics>;
  nodesRanking$: Observable<INodesRanking>;
  officialMempoolSpace = this.stateService.env.OFFICIAL_MEMPOOL_SPACE;
  graphHeight: number = 300;
  statisticsError: string | null = null;
  rankingError: string | null = null;
  statisticsPending = false;
  rankingPending = false;
  private readonly refresh$ = new Subject<void>();
  private readonly destroy$ = new Subject<void>();
  private destroyed = false;

  constructor(
    private lightningApiService: LightningApiService,
    private seoService: SeoService,
    private ogService: OpenGraphService,
    private stateService: StateService,
    private cd: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    this.onResize();

    this.seoService.setTitle($localize`:@@142e923d3b04186ac6ba23387265d22a2fa404e0:Lightning Explorer`);
    this.seoService.setDescription($localize`:@@meta.description.lightning.dashboard:Get stats on the Lightning network (aggregate capacity, connectivity, etc), Lightning nodes (channels, liquidity, etc) and Lightning channels (status, fees, etc).`);

    this.nodesRanking$ = this.scopedRead(() => this.lightningApiService.getNodesRanking$(), 'ranking');
    this.statistics$ = this.scopedRead(() => this.lightningApiService.getLatestStatistics$(), 'statistics');

    // Keep retry scope alive even when failed child widgets are hidden. Both
    // streams terminate on destroy; template subscribers share these reads.
    merge(this.nodesRanking$, this.statistics$).subscribe(() => this.cd.markForCheck());
  }

  private scopedRead<T>(read: () => Observable<T>, kind: 'statistics' | 'ranking'): Observable<T> {
    return merge(this.stateService.networkChanged$, this.refresh$).pipe(switchMap(() => {
      this[kind + 'Error'] = null; this[kind + 'Pending'] = true; this.cd.markForCheck();
      return defer(read).pipe(timeout(15000), catchError(() => {
        this[kind + 'Error'] = `Lightning ${kind === 'ranking' ? 'rankings' : 'statistics'} are unavailable from the selected source. Retry when it is available.`;
        this.cd.markForCheck(); return of(null);
      }), startWith(null), finalize(() => { this[kind + 'Pending'] = false; this.cd.markForCheck(); }));
    }), takeUntil(this.destroy$), shareReplay({ bufferSize: 1, refCount: true }));
  }

  retry(): void {
    if (!this.destroyed && !this.statisticsPending && !this.rankingPending && (this.statisticsError || this.rankingError)) this.refresh$.next();
  }

  ngOnDestroy(): void { this.destroyed = true; this.destroy$.next(); this.destroy$.complete(); this.refresh$.complete(); }

  ngAfterViewInit(): void {
    this.stateService.focusSearchInputDesktop();
  }

  @HostListener('window:resize', ['$event'])
  onResize(): void {
    if (!this.stateService.isBrowser) { return; }
    if (window.innerWidth >= 992) {
      this.graphHeight = 340;
    } else if (window.innerWidth >= 768) {
      this.graphHeight = 245;
    } else {
      this.graphHeight = 210;
    }
  }
}
