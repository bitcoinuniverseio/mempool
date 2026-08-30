import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  distinctUntilChanged,
  filter,
  forkJoin,
  map,
  of,
  startWith,
  switchMap,
  tap,
} from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  CHART_CONFIGS,
  CHART_RANGE_IDS,
  ChartCardConfig,
  ChartPageConfig,
  ChartRangeId,
  ChartValueKind,
  MUTED_LINE_KEYS,
  REFERENCE_LINE_KEYS,
  chartLineLabel,
  unavailableRanges,
} from '@app/universe/chain-graphs/chain-chart-config';
import {
  ChartValueContext,
  formatPointDisplay,
  plotValue,
} from '@app/universe/chain-graphs/chain-chart-format';
import {
  PlottedChartLine,
  buildCardOptions,
} from '@app/universe/chain-graphs/chain-chart-options';
import {
  ChainProfile,
  chainProfile,
  formatTimestamp,
  formatUnixTimestamp,
} from '@app/universe/multichain-explorer/multichain-view';
import { ChartSeriesView, ExplorerChain } from '@app/universe/universe.types';

type CardStatus = 'loading' | 'error' | 'empty' | 'ready';

interface TableRow {
  readonly time: string;
  readonly values: readonly string[];
}

interface CardVm {
  readonly id: string;
  readonly title: string;
  readonly status: CardStatus;
  readonly options: EChartsCoreOption | null;
  /** When stored history starts inside the asked range, the day it starts. */
  readonly historyStart: string | null;
  readonly tableHead: readonly string[];
  readonly tableRows: readonly TableRow[];
}

interface RangeOption {
  readonly id: ChartRangeId;
  readonly disabled: boolean;
}

interface PageVm {
  readonly title: string;
  readonly activeRange: ChartRangeId;
  readonly ranges: readonly RangeOption[];
  readonly cards: readonly CardVm[];
  readonly tables: ReadonlySet<string>;
}

/** Keep the point table readable: about this many rows, evenly sampled. */
const TABLE_ROW_LIMIT = 48;

/**
 * One component for every series chart page in the graphs section. The route
 * says which page through its `chart` data key, and the page config says
 * which cards to draw and how to write their numbers. All five states are
 * real: loading, failed, genuinely empty, partial history, and ready.
 */
@Component({
  selector: 'app-chain-chart',
  standalone: true,
  imports: [CommonModule, NgxEchartsDirective],
  templateUrl: './chain-chart.component.html',
  styleUrls: ['./chain-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainChartComponent implements OnInit {
  readonly chain: Exclude<ExplorerChain, 'bitcoin'>;
  readonly profile: ChainProfile;
  readonly isBrowser: boolean;
  readonly chartInitOptions = { renderer: 'svg' };
  readonly rangeDisabledTitle =
    $localize`:@@universe.graphs.range-disabled:No stored history for this range yet`;

  vm$: Observable<PageVm>;

  private readonly range$ = new BehaviorSubject<ChartRangeId>('1w');
  private readonly retry$ = new BehaviorSubject<number>(0);
  private readonly earliest$ = new BehaviorSubject<number | null>(null);
  private readonly tables$ = new BehaviorSubject<ReadonlySet<string>>(new Set());
  private readonly animate: boolean;

  constructor(
    router: Router,
    private readonly route: ActivatedRoute,
    private readonly api: UniverseApiService,
    private readonly seo: SeoService,
    stateService: StateService
  ) {
    this.chain =
      router.url.split(/[?#]/, 1)[0].split('/').filter(Boolean)[0] === 'dogecoin'
        ? 'dogecoin'
        : 'zcash';
    this.profile = chainProfile(this.chain);
    this.isBrowser = stateService.isBrowser;
    // A reader who asked their system for reduced motion gets no chart
    // animation. Outside a browser there is nothing to animate anyway.
    this.animate =
      this.isBrowser &&
      typeof window.matchMedia === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  ngOnInit(): void {
    const config$ = this.route.data.pipe(
      map((data) => CHART_CONFIGS[data.chart as string]),
      filter((config): config is ChartPageConfig => !!config),
      tap((config) => {
        this.seo.setTitle(
          $localize`:@@universe.graphs.page-title:${this.profile.name}:CHAIN: ${config.title}:PAGE:`
        );
      })
    );

    const cards$ = combineLatest([config$, this.range$, this.retry$]).pipe(
      switchMap(([config, range]) =>
        combineLatest(config.cards.map((card) => this.loadCard(card, range)))
      )
    );

    const ranges$ = this.earliest$.pipe(
      distinctUntilChanged(),
      map((earliest) => {
        const blocked = unavailableRanges(earliest, Date.now() / 1000);
        return CHART_RANGE_IDS.map((id) => ({ id, disabled: blocked.has(id) }));
      })
    );

    this.vm$ = combineLatest([
      config$,
      cards$,
      ranges$,
      this.range$,
      this.tables$,
    ]).pipe(
      map(([config, cards, ranges, activeRange, tables]) => ({
        title: config.title,
        activeRange,
        ranges,
        cards,
        tables,
      }))
    );
  }

  setRange(range: ChartRangeId): void {
    if (range !== this.range$.value) {
      this.range$.next(range);
    }
  }

  retry(): void {
    this.retry$.next(this.retry$.value + 1);
  }

  toggleTable(cardId: string): void {
    const next = new Set(this.tables$.value);
    if (next.has(cardId)) {
      next.delete(cardId);
    } else {
      next.add(cardId);
    }
    this.tables$.next(next);
  }

  trackByCard(_index: number, card: CardVm): string {
    return card.id;
  }

  trackByRange(_index: number, range: RangeOption): string {
    return range.id;
  }

  private loadCard(
    card: ChartCardConfig,
    range: ChartRangeId
  ): Observable<CardVm> {
    return forkJoin(
      card.seriesIds.map((seriesId) =>
        this.api.getChainChartSeries$(this.chain, seriesId, range)
      )
    ).pipe(
      tap((views) => this.noteEarliest(views)),
      map((views) => this.buildCard(card, views)),
      catchError(() =>
        of<CardVm>({
          id: card.id,
          title: card.title,
          status: 'error',
          options: null,
          historyStart: null,
          tableHead: [],
          tableRows: [],
        })
      ),
      startWith<CardVm>({
        id: card.id,
        title: card.title,
        status: 'loading',
        options: null,
        historyStart: null,
        tableHead: [],
        tableRows: [],
      })
    );
  }

  /**
   * Remember when stored history starts, so ranges the collector cannot fill
   * yet can be offered as disabled rather than as pages that come back empty.
   */
  private noteEarliest(views: readonly ChartSeriesView[]): void {
    let earliest: number | null = this.earliest$.value;
    for (const view of views) {
      const raw = view.coverage?.earliestAtomic;
      if (typeof raw !== 'string') {
        continue;
      }
      const seconds = Number(raw);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        continue;
      }
      if (earliest === null || seconds < earliest) {
        earliest = seconds;
      }
    }
    if (earliest !== this.earliest$.value) {
      this.earliest$.next(earliest);
    }
  }

  private buildCard(
    card: ChartCardConfig,
    views: readonly ChartSeriesView[]
  ): CardVm {
    const ctx: ChartValueContext = {
      precision: this.profile.precision,
      ticker: this.profile.ticker,
      rateUnit: views
        .flatMap((view) => view.lines)
        .find((line) => line.key === 'hashrate' || line.key === 'rate')?.unit
        ?? views.find((view) => view.seriesId === 'hashrate')?.lines[0]?.unit
        ?? null,
    };

    const lines: PlottedChartLine[] = [];
    for (const view of views) {
      const seriesIndex = (card.seriesIds as readonly string[]).indexOf(view.seriesId);
      const yAxisIndex: 0 | 1 =
        card.secondaryValueKind && seriesIndex === 1 ? 1 : 0;
      const valueKind: ChartValueKind =
        yAxisIndex === 1 && card.secondaryValueKind
          ? card.secondaryValueKind
          : card.valueKind;
      for (const line of view.lines) {
        // A generic key like "value" on a card that draws several series
        // would name every line the same, so the series id names it instead.
        const labelKey =
          line.key === 'value' || line.key === '' ? view.seriesId : line.key;
        const raw = new Map<number, string | null>();
        const points: [number, number | null][] = [];
        for (const [epochSeconds, value] of line.points) {
          const seconds = Number(epochSeconds);
          if (!Number.isFinite(seconds)) {
            continue;
          }
          const ms = seconds * 1000;
          raw.set(ms, value);
          points.push([ms, plotValue(value, valueKind, this.profile.precision)]);
        }
        lines.push({
          key: line.key,
          label: chartLineLabel(labelKey),
          unit: line.unit || null,
          points,
          raw,
          valueKind,
          yAxisIndex,
          muted: MUTED_LINE_KEYS.has(line.key),
          reference: REFERENCE_LINE_KEYS.has(line.key),
        });
      }
    }

    const hasPoints = lines.some((line) => line.points.length > 0);
    if (!hasPoints) {
      return {
        id: card.id,
        title: card.title,
        status: 'empty',
        options: null,
        historyStart: null,
        tableHead: [],
        tableRows: [],
      };
    }

    // Partial coverage is stated, not hidden: the chart still renders, with a
    // note saying when the stored history begins.
    let historyStart: string | null = null;
    for (const view of views) {
      if (view.coverage && view.coverage.complete === false) {
        const start = formatUnixTimestamp(view.coverage.earliestAtomic);
        if (start) {
          historyStart = start.display;
          break;
        }
      }
    }

    return {
      id: card.id,
      title: card.title,
      status: 'ready',
      options: buildCardOptions({
        kind: card.kind,
        lines,
        primaryKind: card.valueKind,
        secondaryKind: card.secondaryValueKind ?? null,
        ctx,
        animate: this.animate,
        timestampFor: (ms) => this.timestampDisplay(ms),
      }),
      historyStart,
      tableHead: lines.map((line) =>
        line.unit && line.valueKind === 'fee-rate'
          ? `${line.label} (${line.unit})`
          : line.label
      ),
      tableRows: this.tableRows(lines, ctx),
    };
  }

  /**
   * The chart's points as text, downsampled the same way a reader would scan
   * them: evenly across the range, newest last, at most TABLE_ROW_LIMIT rows.
   */
  private tableRows(
    lines: readonly PlottedChartLine[],
    ctx: ChartValueContext
  ): TableRow[] {
    const stamps = new Set<number>();
    for (const line of lines) {
      for (const ms of line.raw.keys()) {
        stamps.add(ms);
      }
    }
    const ordered = [...stamps].sort((a, b) => a - b);
    const step = Math.max(1, Math.ceil(ordered.length / TABLE_ROW_LIMIT));
    const rows: TableRow[] = [];
    for (let i = 0; i < ordered.length; i += step) {
      const ms = ordered[i];
      rows.push({
        time: this.timestampDisplay(ms),
        values: lines.map((line) =>
          formatPointDisplay(line.raw.get(ms) ?? null, line.valueKind, ctx, line.unit)
        ),
      });
    }
    return rows;
  }

  private timestampDisplay(ms: number): string {
    return formatTimestamp(new Date(ms).toISOString())?.display ?? '';
  }
}
