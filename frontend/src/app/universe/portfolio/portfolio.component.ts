import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { PortfolioApiService } from '@app/universe/portfolio/portfolio-api.service';
import {
  PortfolioActivityEvent,
  PortfolioActivityType,
  PortfolioHistoryPoint,
  PortfolioHolding,
  PortfolioPnlReport,
  PortfolioDistributionBucket,
  PortfolioProtocolStatement,
  PortfolioRealization,
  PortfolioSourceState,
  PortfolioSummary,
} from '@app/universe/portfolio/portfolio.types';
import {
  buildCalendarGrid,
  type CalendarGrid,
} from '@app/universe/portfolio/portfolio-calendar';
import {
  buildChartGeometry,
  type ChartGeometry,
} from '@app/universe/portfolio/portfolio-chart';
import {
  COLLECTIBLE_ASSET_TYPES,
  TOKEN_ASSET_TYPES,
  allHoldings,
  emptyMeansEmpty,
  mergeSummaries,
  sortHoldings,
  sourceStateCopy,
} from '@app/universe/portfolio/portfolio-view';
import { formatAtomicAmount, shortenIdentifier } from '@app/universe/universe-evidence';
import { BookmarkButtonComponent } from '@app/universe/bookmark-button/bookmark-button.component';
import { ExplorerChain, ExplorerNetwork } from '@app/universe/universe.types';
import {
  MAXIMUM_GROUP_LENGTH,
  MAXIMUM_LABEL_LENGTH,
  PortfolioWatchlistService,
} from '@app/universe/portfolio/portfolio-watchlist.service';

export type PortfolioTab =
  | 'overview'
  | 'tokens'
  | 'collectibles'
  | 'protocols'
  | 'activity'
  | 'performance'
  | 'pnl'
  | 'coverage';

const TABS: readonly PortfolioTab[] = [
  'overview', 'tokens', 'collectibles', 'protocols', 'activity', 'performance', 'pnl', 'coverage',
];

/** Chains whose classic explorer pages exist, for evidence deep links. */
const ADDRESS_PAGE_BY_CHAIN: Readonly<Record<string, (address: string) => string>> = {
  bitcoin: (address) => `/address/${address}`,
  dogecoin: (address) => `/dogecoin/address/${address}`,
  zcash: (address) => `/zcash/address/${address}`,
};

const CHAIN_LABELS: Readonly<Record<string, string>> = {
  bitcoin: 'Bitcoin',
  fractal: 'Fractal Bitcoin',
  dogecoin: 'Dogecoin',
  zcash: 'Zcash',
};

/** Chains the browser-local bookmark store can represent today. */
const BOOKMARKABLE_CHAINS = new Set(['bitcoin', 'dogecoin', 'zcash']);

interface ActivityState {
  readonly kind: 'idle' | 'loading' | 'ready' | 'unavailable' | 'unsupported';
  readonly events?: readonly PortfolioActivityEvent[];
  readonly nextCursor?: string | null;
  readonly loadingMore?: boolean;
  readonly detail?: string;
}

interface HistoryState {
  readonly kind: 'idle' | 'loading' | 'ready' | 'unavailable' | 'unsupported';
  readonly points?: readonly PortfolioHistoryPoint[];
  readonly geometry?: ChartGeometry;
  readonly complete?: boolean;
  readonly nextCursor?: string | null;
  readonly loadingMore?: boolean;
  readonly unpricedPointCount?: number;
  readonly openingBalanceAtomic?: string;
  readonly detail?: string;
}

interface PnlState {
  readonly kind:
    | 'idle'
    | 'loading'
    | 'ready'
    | 'unavailable'
    | 'unsupported'
    | 'outside-coverage';
  readonly report?: PortfolioPnlReport;
  readonly detail?: string;
}

interface PortfolioPageState {
  readonly kind: 'loading' | 'ready' | 'invalid' | 'unavailable' | 'unknown-network';
  readonly summary?: PortfolioSummary;
  readonly nextCursor?: string | null;
  readonly loadingMore?: boolean;
}

/**
 * The address portfolio: everything the configured protocol authorities can
 * prove one address holds on one explicit chain and network, with the state
 * of every source shown next to what it answered. A source that did not
 * answer is a visible statement here, never a hidden zero.
 */
@Component({
  selector: 'app-universe-portfolio',
  standalone: true,
  imports: [CommonModule, RouterModule, BookmarkButtonComponent],
  templateUrl: './portfolio.component.html',
  styleUrls: ['./portfolio.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioComponent implements OnInit, OnDestroy {
  chain = '';
  network = '';
  address = '';
  tab: PortfolioTab = 'overview';
  state: PortfolioPageState = { kind: 'loading' };
  activity: ActivityState = { kind: 'idle' };
  history: HistoryState = { kind: 'idle' };
  pnl: PnlState = { kind: 'idle' };

  readonly shorten = shortenIdentifier;
  readonly stateCopy = sourceStateCopy;
  readonly emptyMeansEmpty = emptyMeansEmpty;

  private subscriptions = new Subscription();

  watched = false;
  editingLabel = false;
  labelDraft = '';
  groupDraft = '';
  readonly maximumLabelLength = MAXIMUM_LABEL_LENGTH;
  readonly maximumGroupLength = MAXIMUM_GROUP_LENGTH;

  constructor(
    private route: ActivatedRoute,
    private api: PortfolioApiService,
    private seo: SeoService,
    private watchlist: PortfolioWatchlistService,
    private changeDetector: ChangeDetectorRef,
  ) {}

  /** The visitor's own name for this address, or the empty string. */
  get watchLabel(): string {
    return this.watchlist.watchedEntry(this.chain, this.network, this.address)?.label ?? '';
  }

  get watchGroup(): string {
    return this.watchlist.watchedEntry(this.chain, this.network, this.address)?.group ?? '';
  }

  get knownGroups(): readonly string[] {
    return this.watchlist.groups();
  }

  toggleWatch(): void {
    this.watched = this.watchlist.toggle({
      chain: this.chain,
      network: this.network,
      address: this.address,
    });
    this.changeDetector.markForCheck();
  }

  startEditingLabel(): void {
    this.labelDraft = this.watchLabel;
    this.groupDraft = this.watchGroup;
    this.editingLabel = true;
    this.changeDetector.markForCheck();
  }

  cancelEditingLabel(): void {
    this.editingLabel = false;
    this.changeDetector.markForCheck();
  }

  saveLabel(): void {
    this.watchlist.watch({
      chain: this.chain,
      network: this.network,
      address: this.address,
      label: this.labelDraft,
      group: this.groupDraft,
    });
    this.watched = true;
    this.editingLabel = false;
    this.changeDetector.markForCheck();
  }

  ngOnInit(): void {
    this.subscriptions.add(this.route.paramMap.subscribe((params) => {
      this.chain = params.get('chain') ?? '';
      this.network = params.get('network') ?? '';
      this.address = params.get('address') ?? '';
      this.seo.setTitle(
        $localize`:@@universe.portfolio.page-title:Portfolio of ${this.shorten(this.address)}:address: on ${this.chainLabel()}:chain:`
      );
      this.watched = this.watchlist.isWatched(this.chain, this.network, this.address);
      this.editingLabel = false;
      this.load();
    }));
    this.subscriptions.add(this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab') as PortfolioTab | null;
      this.tab = tab !== null && TABS.includes(tab) ? tab : 'overview';
      this.loadTabData();
      this.changeDetector.markForCheck();
    }));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private load(): void {
    this.state = { kind: 'loading' };
    this.activity = { kind: 'idle' };
    this.history = { kind: 'idle' };
    this.pnl = { kind: 'idle' };
    this.loadTabData();
    this.changeDetector.markForCheck();
    this.subscriptions.add(
      this.api.getSummary$(this.chain, this.network, this.address).subscribe({
        next: (response) => {
          this.state = {
            kind: 'ready',
            summary: response.summary,
            nextCursor: response.nextCursor,
            loadingMore: false,
          };
          this.changeDetector.markForCheck();
        },
        error: (error: { status?: number }) => {
          this.state = {
            kind: error?.status === 400 ? 'invalid'
              : error?.status === 404 ? 'unknown-network'
              : 'unavailable',
          };
          this.changeDetector.markForCheck();
        },
      })
    );
  }

  /** Loads whatever the visible tab needs, once, on first view. */
  private loadTabData(): void {
    if (this.tab === 'activity' && this.activity.kind === 'idle') {
      this.loadActivity();
    }
    if (
      (this.tab === 'performance' || this.tab === 'overview')
      && this.history.kind === 'idle'
    ) {
      this.loadHistory();
    }
    if (this.tab === 'pnl' && this.pnl.kind === 'idle') {
      this.loadPnl();
    }
  }

  private loadHistory(cursor?: string): void {
    if (!this.address || !this.chain) { return; }
    const previous = this.history.kind === 'ready' && cursor !== undefined
      ? (this.history.points ?? [])
      : [];
    this.history = cursor === undefined
      ? { kind: 'loading' }
      : { ...this.history, loadingMore: true };
    this.changeDetector.markForCheck();
    this.subscriptions.add(
      this.api.getHistory$(this.chain, this.network, this.address, cursor).subscribe({
        next: (page) => {
          if (page.state === 'unsupported') {
            this.history = { kind: 'unsupported', detail: page.detail };
          } else {
            // Older pages arrive after newer ones; the series stays in
            // oldest-first order so the chart reads left to right in time.
            const points = [...(page.points ?? []), ...previous];
            this.history = {
              kind: 'ready',
              points,
              geometry: buildChartGeometry(points),
              complete: page.complete ?? false,
              nextCursor: page.nextCursor ?? null,
              loadingMore: false,
              unpricedPointCount: page.unpricedPointCount ?? 0,
              openingBalanceAtomic: page.openingBalanceAtomic,
            };
          }
          this.changeDetector.markForCheck();
        },
        error: () => {
          this.history = cursor === undefined
            ? { kind: 'unavailable' }
            : { ...this.history, loadingMore: false };
          this.changeDetector.markForCheck();
        },
      })
    );
  }

  loadMoreHistory(): void {
    if (this.history.kind === 'ready' && this.history.nextCursor && !this.history.loadingMore) {
      this.loadHistory(this.history.nextCursor);
    }
  }

  private loadPnl(): void {
    if (!this.address || !this.chain) { return; }
    this.pnl = { kind: 'loading' };
    this.changeDetector.markForCheck();
    this.subscriptions.add(
      this.api.getPnl$(this.chain, this.network, this.address).subscribe({
        next: (report) => {
          if (report.state === 'unsupported') {
            this.pnl = { kind: 'unsupported', detail: report.detail };
          } else if (report.state === 'outside_coverage') {
            this.pnl = { kind: 'outside-coverage', detail: report.detail };
          } else {
            this.pnl = { kind: 'ready', report };
          }
          this.changeDetector.markForCheck();
        },
        error: () => {
          this.pnl = { kind: 'unavailable' };
          this.changeDetector.markForCheck();
        },
      })
    );
  }

  exportUrl(format: 'assets-csv' | 'activity-csv' | 'evidence-json'): string {
    return this.api.exportUrl(this.chain, this.network, this.address, format);
  }

  /** A balance in whole coins, exact string arithmetic only. */
  coins(atomic: string | null | undefined): string | null {
    if (atomic === null || atomic === undefined) { return null; }
    const negative = atomic.startsWith('-');
    const magnitude = negative ? atomic.slice(1) : atomic;
    if (!/^(0|[1-9][0-9]*)$/.test(magnitude)) { return null; }
    const formatted = formatAtomicAmount(magnitude, 8);
    return negative ? `-${formatted}` : formatted;
  }

  /** True when an exact decimal string is negative. */
  isNegative(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith('-');
  }

  /** The calendar grid for the loaded report, built once per report. */
  private calendarCache: { source: unknown; grid: CalendarGrid } | null = null;

  get calendarGrid(): CalendarGrid | null {
    const days = this.pnl.report?.analytics?.calendar;
    if (!days || days.length === 0) { return null; }
    if (this.calendarCache?.source !== days) {
      this.calendarCache = { source: days, grid: buildCalendarGrid(days) };
    }
    return this.calendarCache.grid;
  }

  /** A readable label for a return bucket, from its own bounds. */
  bucketLabel(bucket: PortfolioDistributionBucket): string {
    const percent = (ratio: string): string => {
      const negative = ratio.startsWith('-');
      const magnitude = negative ? ratio.slice(1) : ratio;
      const [whole, fraction = ''] = magnitude.split('.');
      const shifted = (whole + fraction.padEnd(2, '0')).replace(/^0+(?=d)/, '');
      return `${negative ? '-' : ''}${shifted}`;
    };
    if (bucket.fromRatio === null && bucket.toRatio !== null) {
      return $localize`:@@universe.portfolio.bucket-below:Worse than ${percent(bucket.toRatio)}:bound:%`;
    }
    if (bucket.toRatio === null && bucket.fromRatio !== null) {
      return $localize`:@@universe.portfolio.bucket-above:Better than ${percent(bucket.fromRatio)}:bound:%`;
    }
    if (bucket.fromRatio === null || bucket.toRatio === null) { return bucket.id; }
    return `${percent(bucket.fromRatio)}% to ${percent(bucket.toRatio)}%`;
  }

  /** A calendar cell class from its band, so colour is never the only cue. */
  bandClass(band: number | null): string {
    if (band === null) { return 'band-empty'; }
    if (band === 0) { return 'band-flat'; }
    return band > 0 ? `band-gain-${band}` : `band-loss-${-band}`;
  }

  pnlTone(value: string | null | undefined): string {
    if (value === null || value === undefined) { return 'tone-muted'; }
    if (value.startsWith('-')) { return 'tone-bad'; }
    return value === '0' ? 'tone-muted' : 'tone-good';
  }

  /** The P/L ratio as a percentage string, exact digits preserved. */
  ratioPercent(ratio: string | null | undefined): string | null {
    if (ratio === null || ratio === undefined) { return null; }
    const negative = ratio.startsWith('-');
    const magnitude = negative ? ratio.slice(1) : ratio;
    if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(magnitude)) { return null; }
    // Times 100 by shifting the decimal point, so no float is involved.
    const [whole, fraction = ''] = magnitude.split('.');
    const digits = whole + fraction.padEnd(2, '0');
    const shifted = fraction.length <= 2
      ? digits
      : `${digits.slice(0, whole.length + 2)}.${digits.slice(whole.length + 2)}`;
    const trimmed = shifted.replace(/^0+(?=[0-9])/, '');
    return `${negative ? '-' : ''}${trimmed}`;
  }

  trackByLot(index: number, lot: { eventId: string }): string {
    return lot.eventId;
  }

  trackByRealization(index: number, realization: PortfolioRealization): string {
    return realization.eventId;
  }

  trackByPoint(index: number, point: PortfolioHistoryPoint): string {
    return point.txid;
  }

  private loadActivity(cursor?: string): void {
    if (!this.address || !this.chain) { return; }
    const previous = this.activity.kind === 'ready' && cursor !== undefined
      ? (this.activity.events ?? [])
      : [];
    this.activity = cursor === undefined
      ? { kind: 'loading' }
      : { ...this.activity, loadingMore: true };
    this.changeDetector.markForCheck();
    this.subscriptions.add(
      this.api.getActivity$(this.chain, this.network, this.address, cursor).subscribe({
        next: (page) => {
          if (page.state === 'unsupported') {
            this.activity = { kind: 'unsupported', detail: page.detail };
          } else {
            this.activity = {
              kind: 'ready',
              events: [...previous, ...(page.events ?? [])],
              nextCursor: page.nextCursor ?? null,
              loadingMore: false,
            };
          }
          this.changeDetector.markForCheck();
        },
        error: () => {
          this.activity = cursor === undefined
            ? { kind: 'unavailable' }
            : { ...this.activity, loadingMore: false };
          this.changeDetector.markForCheck();
        },
      })
    );
  }

  loadMoreActivity(): void {
    if (this.activity.kind === 'ready' && this.activity.nextCursor && !this.activity.loadingMore) {
      this.loadActivity(this.activity.nextCursor);
    }
  }

  activityTypeLabel(type: PortfolioActivityType): string {
    switch (type) {
      case 'receive': return $localize`:@@universe.portfolio.activity-receive:Received`;
      case 'send': return $localize`:@@universe.portfolio.activity-send:Sent`;
      case 'self-transfer': return $localize`:@@universe.portfolio.activity-self:Moved within this address`;
      case 'coinbase-reward': return $localize`:@@universe.portfolio.activity-coinbase:Mining reward`;
      case 'unknown': return $localize`:@@universe.portfolio.activity-unknown:Unrecognized shape`;
    }
  }

  /** The event amount in whole coins, exact string arithmetic only. */
  activityAmount(event: PortfolioActivityEvent): string {
    return formatAtomicAmount(event.amountAtomic, 8);
  }

  activityFee(event: PortfolioActivityEvent): string | null {
    return event.feePaidAtomic === null ? null : formatAtomicAmount(event.feePaidAtomic, 8);
  }

  activitySign(event: PortfolioActivityEvent): string {
    if (event.type === 'send') { return '-'; }
    if (event.type === 'receive' || event.type === 'coinbase-reward') { return '+'; }
    return '';
  }

  trackByEvent(index: number, event: PortfolioActivityEvent): string {
    return event.eventId;
  }

  loadMore(): void {
    const current = this.state;
    if (current.kind !== 'ready' || !current.nextCursor || current.loadingMore) { return; }
    this.state = { ...current, loadingMore: true };
    this.changeDetector.markForCheck();
    this.subscriptions.add(
      this.api.getSummary$(this.chain, this.network, this.address, current.nextCursor).subscribe({
        next: (response) => {
          this.state = {
            kind: 'ready',
            summary: mergeSummaries(current.summary, response.summary),
            nextCursor: response.nextCursor,
            loadingMore: false,
          };
          this.changeDetector.markForCheck();
        },
        error: () => {
          // The accumulated pages stay; only the continuation failed.
          this.state = { ...current, loadingMore: false };
          this.changeDetector.markForCheck();
        },
      })
    );
  }

  chainLabel(): string {
    return CHAIN_LABELS[this.chain] ?? this.chain;
  }

  bookmarkable(): boolean {
    return BOOKMARKABLE_CHAINS.has(this.chain) && this.network === 'mainnet';
  }

  bookmarkChain(): ExplorerChain {
    return this.chain as ExplorerChain;
  }

  bookmarkNetwork(): ExplorerNetwork {
    return this.network as ExplorerNetwork;
  }

  addressPageLink(): string | null {
    if (this.network !== 'mainnet') { return null; }
    const builder = ADDRESS_PAGE_BY_CHAIN[this.chain];
    return builder ? builder(this.address) : null;
  }

  tabLink(tab: PortfolioTab): Record<string, string> {
    return { tab };
  }

  /** Every holding, deterministically ordered, the native balance first. */
  holdings(summary: PortfolioSummary): PortfolioHolding[] {
    return sortHoldings(allHoldings(summary));
  }

  tokens(summary: PortfolioSummary): PortfolioHolding[] {
    return this.holdings(summary).filter(
      (holding) => TOKEN_ASSET_TYPES.includes(holding.identity.assetType)
    );
  }

  collectibles(summary: PortfolioSummary): PortfolioHolding[] {
    return this.holdings(summary).filter(
      (holding) => COLLECTIBLE_ASSET_TYPES.includes(holding.identity.assetType)
    );
  }

  topHoldings(summary: PortfolioSummary): PortfolioHolding[] {
    return this.holdings(summary).slice(0, 8);
  }

  /** Protocols with anything to show, then the answered-empty, then the rest. */
  protocolStatements(summary: PortfolioSummary): PortfolioProtocolStatement[] {
    return [...summary.protocols].sort((a, b) => {
      const aRank = a.holdings.length > 0 ? 0 : a.state === 'proven' ? 1 : 2;
      const bRank = b.holdings.length > 0 ? 0 : b.state === 'proven' ? 1 : 2;
      return aRank - bRank || a.protocol.localeCompare(b.protocol);
    });
  }

  answeringStatements(summary: PortfolioSummary): PortfolioProtocolStatement[] {
    return summary.protocols.filter((statement) => statement.holdings.length > 0);
  }

  unansweredCount(summary: PortfolioSummary): number {
    return summary.protocols.filter(
      (statement) => statement.state === 'unavailable' || statement.state === 'partial'
    ).length;
  }

  unsupportedCount(summary: PortfolioSummary): number {
    return summary.protocols.filter((statement) => statement.state === 'unsupported').length;
  }

  /**
   * The truthful sentence under the headline numbers. Every total names its
   * own coverage; a normal-looking number never hides a partial answer.
   */
  coverageSentence(summary: PortfolioSummary): string {
    const unanswered = this.unansweredCount(summary);
    if (unanswered > 0) {
      return $localize`:@@universe.portfolio.coverage-partial:${unanswered}:count: protocol sources did not answer in full, so this portfolio may be incomplete.`;
    }
    if (summary.valuation.unpricedHoldingCount > 0) {
      return $localize`:@@universe.portfolio.coverage-unpriced:${summary.valuation.unpricedHoldingCount}:count: holdings are unpriced and are excluded from any displayed value.`;
    }
    return $localize`:@@universe.portfolio.coverage-complete:Every configured source answered in full.`;
  }

  emptyPortfolioSentence(summary: PortfolioSummary): string {
    return this.unansweredCount(summary) > 0
      ? $localize`:@@universe.portfolio.empty-partial:No assets were found, but not every source answered, so this is not proof of an empty portfolio.`
      : $localize`:@@universe.portfolio.empty-proven:No assets were found by all responding sources.`;
  }

  quantity(holding: PortfolioHolding): string | null {
    if (holding.quantityAtomic === null) { return null; }
    return formatAtomicAmount(holding.quantityAtomic, holding.decimals ?? 0);
  }

  spendable(holding: PortfolioHolding): string | null {
    if (holding.spendableAtomic === undefined) { return null; }
    return formatAtomicAmount(holding.spendableAtomic, holding.decimals ?? 0);
  }

  transferable(holding: PortfolioHolding): string | null {
    if (holding.transferableAtomic === undefined) { return null; }
    return formatAtomicAmount(holding.transferableAtomic, holding.decimals ?? 0);
  }

  pendingIncoming(holding: PortfolioHolding): string | null {
    if (holding.pendingIncomingAtomic === undefined || holding.pendingIncomingAtomic === '0') { return null; }
    return formatAtomicAmount(holding.pendingIncomingAtomic, holding.decimals ?? 0);
  }

  holdingName(holding: PortfolioHolding): string {
    return holding.displayName
      || holding.ticker
      || this.shorten(holding.identity.assetId, 10);
  }

  protocolLabel(protocolId: string): string {
    const words = protocolId.replace(/[_-]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /** Router link into the evidence page for one custody outpoint, if any. */
  custodyLink(holding: PortfolioHolding): string[] | null {
    if (this.chain !== 'bitcoin') { return null; }
    const outpoint = holding.custody.find((ref) => ref.kind === 'outpoint');
    if (!outpoint) { return null; }
    const separator = outpoint.reference.lastIndexOf(':');
    if (separator !== 64) { return null; }
    return ['/outpoint', outpoint.reference.slice(0, 64), outpoint.reference.slice(65)];
  }

  custodyCount(holding: PortfolioHolding): number {
    return holding.custody.filter((ref) => ref.kind === 'outpoint').length;
  }

  stateTone(state: PortfolioSourceState): string {
    switch (state) {
      case 'proven': return 'tone-good';
      case 'partial':
      case 'pending':
      case 'stale': return 'tone-warn';
      case 'unavailable': return 'tone-bad';
      default: return 'tone-muted';
    }
  }

  trackByHolding(index: number, holding: PortfolioHolding): string {
    return holding.assetKey;
  }

  trackByStatement(index: number, statement: PortfolioProtocolStatement): string {
    return statement.protocol;
  }
}
