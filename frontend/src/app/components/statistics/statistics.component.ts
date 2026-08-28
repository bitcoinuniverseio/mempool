import { Component, OnInit, OnDestroy, LOCALE_ID, Inject, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { UntypedFormGroup, UntypedFormBuilder } from '@angular/forms';
import { BehaviorSubject, Observable, Subscription, combineLatest, of } from 'rxjs';
import { distinctUntilChanged, map, startWith } from 'rxjs/operators';

import { OptimizedMempoolStats } from '@interfaces/node-api.interface';
import { WebsocketService } from '@app/services/websocket.service';
import { ApiService } from '@app/services/api.service';

import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { StorageService } from '@app/services/storage.service';
import { feeLevels } from '@app/app.constants';
import { MempoolGraphComponent } from '@components/mempool-graph/mempool-graph.component';
import { IncomingTransactionsGraphComponent } from '@components/incoming-transactions-graph/incoming-transactions-graph.component';
import { feeScale } from '@app/shared/chart-theme';
import { LoadState, trackedLoadState } from '@app/shared/load-state';

type DateSpan = '2h' | '24h' | '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | '3y' | '4y' | 'all';

const DATE_SPANS: DateSpan[] = ['2h', '24h', '1w', '1m', '3m', '6m', '1y', '2y', '3y', '4y', 'all'];

/** Seconds each range asks for. `all` asks for whatever exists, so it is absent. */
const RANGE_SECONDS: Partial<Record<DateSpan, number>> = {
  '2h': 2 * 3600,
  '24h': 24 * 3600,
  '1w': 7 * 24 * 3600,
  '1m': 30 * 24 * 3600,
  '3m': 90 * 24 * 3600,
  '6m': 180 * 24 * 3600,
  '1y': 365 * 24 * 3600,
  '2y': 2 * 365 * 24 * 3600,
  '3y': 3 * 365 * 24 * 3600,
  '4y': 4 * 365 * 24 * 3600,
};

@Component({
  selector: 'app-statistics',
  templateUrl: './statistics.component.html',
  styleUrls: ['./statistics.component.scss'],
  standalone: false,
})
export class StatisticsComponent implements OnInit, OnDestroy {
  @ViewChild('mempoolgraph') mempoolGraph: MempoolGraphComponent;
  @ViewChild('incominggraph') incomingGraph: IncomingTransactionsGraphComponent;

  network = '';

  feeLevels = feeLevels;
  chartColors = feeScale();
  filterSize = 100000;
  filterFeeIndex = 0;
  showCount = false;
  maxFeeIndex: number;
  dropDownOpen = false;
  outlierCappingEnabled = false;
  mempoolStats: OptimizedMempoolStats[] = [];

  /**
   * The single source of truth for what this page is showing. It always reaches
   * a terminal state, so the chart can never be left behind a spinner that
   * nothing will clear.
   */
  state$: Observable<LoadState<OptimizedMempoolStats[]>>;
  state: LoadState<OptimizedMempoolStats[]> = { status: 'loading' };

  mempoolVsizeFeesData: any;
  mempoolUnconfirmedTransactionsData: any;
  mempoolTransactionsWeightPerSecondData: any;

  radioGroupForm: UntypedFormGroup;
  graphWindowPreference: string;
  inverted: boolean;
  feeLevelDropdownData = [];
  timespan = '';
  titleCount = $localize`Count`;
  /** Set when the collected history is shorter than the range asked for. */
  boundedHistoryNote: string | null = null;

  private retry$ = new BehaviorSubject<number>(0);
  private subscriptions: Subscription[] = [];

  constructor(
    @Inject(LOCALE_ID) private locale: string,
    private formBuilder: UntypedFormBuilder,
    private route: ActivatedRoute,
    private websocketService: WebsocketService,
    private apiService: ApiService,
    public stateService: StateService,
    private seoService: SeoService,
    private storageService: StorageService,
  ) { }

  ngOnInit(): void {
    this.inverted = this.storageService.getValue('inverted-graph') === 'true';
    this.setFeeLevelDropdownData();
    this.seoService.setTitle($localize`:@@5d4f792f048fcaa6df5948575d7cb325c9393383:Graphs`);
    this.seoService.setDescription($localize`:@@meta.description.bitcoin.graphs.mempool:See mempool size (in MvB) and transactions per second (in vB/s) visualized over time.`);
    this.subscriptions.push(
      this.stateService.networkChanged$.subscribe((network) => this.network = network),
    );
    this.graphWindowPreference = this.storageService.getValue('graphWindowPreference') ? this.storageService.getValue('graphWindowPreference').trim() : '2h';
    this.outlierCappingEnabled = this.storageService.getValue('cap-outliers') === 'true';

    this.radioGroupForm = this.formBuilder.group({
      dateSpan: this.graphWindowPreference
    });

    this.subscriptions.push(
      this.route.fragment.subscribe((fragment) => {
        const span = DATE_SPANS.includes(fragment as DateSpan) ? fragment as DateSpan : '2h';
        this.radioGroupForm.controls.dateSpan.setValue(span, { emitEvent: false });
      }),
    );

    // A retry re-runs the current range without changing it, so the same
    // switchMap cancels whatever is in flight and starts exactly one request.
    const trigger$ = combineLatest([
      this.radioGroupForm.controls.dateSpan.valueChanges.pipe(
        startWith(this.radioGroupForm.controls.dateSpan.value),
        distinctUntilChanged(),
      ),
      this.retry$,
    ]).pipe(
      map(([dateSpan, attempt]) => `${dateSpan}:${attempt}`),
    );

    this.state$ = trackedLoadState(
      trigger$,
      (key) => {
        const dateSpan = key.split(':')[0] as DateSpan;
        this.timespan = dateSpan;
        if (dateSpan === '2h') {
          this.websocketService.want(['blocks', 'live-2h-chart']);
        } else {
          this.websocketService.want(['blocks']);
        }
        return this.statisticsFor(dateSpan);
      },
    );

    this.subscriptions.push(
      this.state$.subscribe((state) => {
        this.state = state;
        if (state.status === 'data' || state.status === 'stale') {
          this.mempoolStats = state.value;
          this.handleNewMempoolData(this.mempoolStats.concat([]));
        } else {
          this.mempoolStats = [];
          this.mempoolTransactionsWeightPerSecondData = null;
        }
        this.updateBoundedHistoryNote();
      }),
    );

    this.subscriptions.push(
      this.stateService.live2Chart$.subscribe((mempoolStats) => {
        // A live sample is only meaningful on top of a loaded 2h series. With
        // no series it would render a one-point chart over a failed load.
        if (this.timespan !== '2h' || !this.mempoolStats.length) {
          return;
        }
        this.mempoolStats.unshift(mempoolStats);
        this.mempoolStats = this.mempoolStats.slice(0, this.mempoolStats.length - 1);
        this.handleNewMempoolData(this.mempoolStats.concat([]));
        this.updateBoundedHistoryNote();
      }),
    );
  }

  ngOnDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  /** Asks for one range. Anything unrecognised falls back to the live range. */
  private statisticsFor(dateSpan: DateSpan): Observable<OptimizedMempoolStats[]> {
    switch (dateSpan) {
      case '24h': return this.apiService.list24HStatistics$();
      case '1w': return this.apiService.list1WStatistics$();
      case '1m': return this.apiService.list1MStatistics$();
      case '3m': return this.apiService.list3MStatistics$();
      case '6m': return this.apiService.list6MStatistics$();
      case '1y': return this.apiService.list1YStatistics$();
      case '2y': return this.apiService.list2YStatistics$();
      case '3y': return this.apiService.list3YStatistics$();
      case '4y': return this.apiService.list4YStatistics$();
      case 'all': return this.apiService.listAllTimeStatistics$();
      case '2h': return this.apiService.list2HStatistics$();
      default: return of([]);
    }
  }

  /** Re-runs the current range after a failure. */
  onRetry(): void {
    this.retry$.next(this.retry$.value + 1);
  }

  /** True while the chart has real numbers to draw, fresh or stale. */
  get hasData(): boolean {
    return (this.state.status === 'data' || this.state.status === 'stale') && this.mempoolStats.length > 0;
  }

  /**
   * Recomputes how far back this deployment can actually answer for, when that
   * is noticeably less than the range asked for.
   *
   * Statistics are collected from the moment the writer starts; nothing
   * backfills them, because there is no first-party source to backfill from and
   * inventing rows would be worse than having none. Drawing two hours of
   * samples under a heading that says 1W is not a lie the chart tells on
   * purpose, but it is one a reader would take away, so the shortfall is
   * stated.
   *
   * Computed when the series changes rather than read from a getter: as a
   * getter it walked the whole series on every change detection pass, on a page
   * that takes a live sample every minute.
   */
  private updateBoundedHistoryNote(): void {
    this.boundedHistoryNote = null;
    if (!this.hasData) return;
    const requested = RANGE_SECONDS[this.timespan];
    if (!requested) return;
    let oldest = Number.POSITIVE_INFINITY;
    for (const stats of this.mempoolStats) {
      if (stats.added < oldest) oldest = stats.added;
    }
    if (!Number.isFinite(oldest)) return;
    const covered = Math.max(0, Math.floor(Date.now() / 1000) - oldest);
    // A tenth short of the range is ordinary sampling slack, not a shortfall.
    if (covered >= requested * 0.9) return;
    this.boundedHistoryNote =
      $localize`:@@statistics.bounded-history:Collection began ${this.describeSpan(covered)}:covered: ago, so this is all the history there is for this range.`;
  }

  /** A short, human span for the note above. */
  private describeSpan(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    if (hours < 1) {
      const minutes = Math.max(1, Math.floor(seconds / 60));
      return minutes === 1
        ? $localize`:@@statistics.span-minute:1 minute`
        : $localize`:@@statistics.span-minutes:${minutes}:minutes: minutes`;
    }
    if (hours < 48) {
      return hours === 1
        ? $localize`:@@statistics.span-hour:1 hour`
        : $localize`:@@statistics.span-hours:${hours}:hours: hours`;
    }
    const days = Math.floor(hours / 24);
    return days === 1
      ? $localize`:@@statistics.span-day:1 day`
      : $localize`:@@statistics.span-days:${days}:days: days`;
  }

  handleNewMempoolData(mempoolStats: OptimizedMempoolStats[]): void {
    mempoolStats.reverse();
    const labels = mempoolStats.map(stats => stats.added);

    let maxTier = 0;
    for (let index = 38; index > -1; index--) {
      mempoolStats.forEach((stats) => {
        if (stats.vsizes[index] >= this.filterSize) {
          maxTier = Math.max(maxTier, index);
        }
      });
    }
    this.maxFeeIndex = maxTier;

    this.mempoolTransactionsWeightPerSecondData = {
      labels: labels,
      series: [mempoolStats.map((stats) => [stats.added * 1000, stats.vbytes_per_second])],
    };
  }

  saveGraphPreference(): void {
    this.storageService.setValue('graphWindowPreference', this.radioGroupForm.controls.dateSpan.value);
  }

  invertGraph(): void {
    this.storageService.setValue('inverted-graph', !this.inverted);
    document.location.reload();
  }

  setFeeLevelDropdownData(): void {
    let _feeLevels = feeLevels;
    const scale = feeScale();
    let _chartColors = scale;
    if (!this.inverted) {
      _feeLevels = [...feeLevels].reverse();
      _chartColors = [...scale].reverse();
    }
    _feeLevels.forEach((fee, i) => {
      let range;
      const nextIndex = this.inverted ? i + 1 : i - 1;
      if (this.stateService.isLiquid()) {
        if (_feeLevels[nextIndex] == null) {
          range = `${(_feeLevels[i] / 10).toFixed(1)}+`;
        } else {
          range = `${(_feeLevels[i] / 10).toFixed(1)} - ${(_feeLevels[nextIndex] / 10).toFixed(1)}`;
        }
      } else {
        if (_feeLevels[nextIndex] == null) {
          range = `${_feeLevels[i]}+`;
        } else {
          range = `${_feeLevels[i]} - ${_feeLevels[nextIndex]}`;
        }
      }
      this.feeLevelDropdownData.push({
        fee: fee,
        range,
        color: _chartColors[i],
      });
    });
  }

  onOutlierToggleChange(e): void {
    this.outlierCappingEnabled = e.target.checked;
    this.storageService.setValue('cap-outliers', e.target.checked);
  }

  onSaveChart(name): void {
    if (name === 'mempool') {
      this.mempoolGraph.onSaveChart(this.timespan);
    } else if (name === 'incoming') {
      this.incomingGraph.onSaveChart(this.timespan);
    }
  }

  isMobile(): boolean {
    return (window.innerWidth <= 767.98);
  }
}
