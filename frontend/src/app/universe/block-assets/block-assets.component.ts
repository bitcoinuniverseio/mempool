import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  Optional,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription, filter, timer } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseWebsocketService } from '@app/universe/universe-websocket.service';
import { UniverseSharedModule } from '@app/universe/universe-shared.module';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import {
  BlockAssetActivitySummary,
  BlockAssetEvent,
  BlockAssetEventQuery,
  BlockAssetOperationGroup,
  BlockAssetSort,
  BlockProtocolCoverage,
  ExplorerChain,
  ExplorerProtocolDefinition,
} from '@app/universe/universe.types';
import { formatAtomicAmount, shortenIdentifier } from '@app/universe/universe-evidence';
import {
  assetKindLabel,
  assetLabel,
  assetRoute,
  BlockCoverageNotice,
  breakdownRows,
  coverageLabel,
  coverageNotices,
  emptyStateMessage,
  evidenceLabel,
  limitedRows,
  operationLabel,
  protocolRoute,
  quantityLabel,
  transactionRoute,
} from './block-assets.view';

type SummaryState =
  | { readonly kind: 'idle' | 'loading' }
  | { readonly kind: 'ready'; readonly summary: BlockAssetActivitySummary }
  | { readonly kind: 'error'; readonly reason: 'unconfigured' | 'not-found' | 'unavailable' };

const PAGE_SIZE = 50;
/** Polls a snapshot still being built for at most about ten minutes. */
const MAX_POLLS = 200;

/**
 * Assets & Protocol Activity for one confirmed block, on any chain the
 * overlay serves. The overlay aggregates every authority into one summary
 * and one paged event list; this component never talks to an indexer.
 */
@Component({
  selector: 'app-universe-block-assets',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, UniverseSharedModule],
  templateUrl: './block-assets.component.html',
  styleUrls: ['./block-assets.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockAssetsComponent implements OnChanges, OnDestroy {
  @Input() chain: ExplorerChain = 'bitcoin';
  /** Block hash (preferred) or height. */
  @Input() reference: string | null = null;

  state: SummaryState = { kind: 'idle' };
  events: BlockAssetEvent[] = [];
  eventsTotal = '0';
  nextCursor: string | null = null;
  eventsLoading = false;
  eventsFailed = false;
  txidInvalid = false;

  group: BlockAssetOperationGroup | '' = '';
  protocol = '';
  assetKind = '';
  txid = '';
  query = '';
  sort: BlockAssetSort = 'tx';

  readonly groups: readonly { value: BlockAssetOperationGroup | ''; label: string }[] = [
    { value: '', label: $localize`:@@universe.block-assets.filter.all:All activity` },
    { value: 'transfer', label: $localize`:@@universe.block-assets.filter.transfers:Transfers` },
    { value: 'creation', label: $localize`:@@universe.block-assets.filter.creations:Mints and creations` },
    { value: 'burn', label: $localize`:@@universe.block-assets.filter.burns:Burns` },
    { value: 'position', label: $localize`:@@universe.block-assets.filter.positions:Assets on outputs` },
    { value: 'other', label: $localize`:@@universe.block-assets.filter.other:Other protocol operations` },
  ];
  readonly assetKinds = ['inscription', 'fungible', 'non-fungible', 'name', 'sat', 'data', 'protocol-event'];

  readonly operationLabel = operationLabel;
  readonly assetKindLabel = assetKindLabel;
  readonly assetLabel = assetLabel;
  readonly coverageLabel = coverageLabel;
  readonly evidenceLabel = evidenceLabel;
  readonly quantityLabel = quantityLabel;
  readonly shorten = shortenIdentifier;
  readonly filteredEmpty = $localize`:@@universe.block-assets.filtered-empty:No records match these filters.`;

  private summarySubscription: Subscription | null = null;
  private liveSubscription: Subscription | null = null;
  /** Inscriptions whose preview failed to load, so the slot is not retried. */
  private readonly failedPreviews = new Set<string>();
  private eventsSubscription: Subscription | null = null;
  private polls = 0;
  private readonly badges = new Map<string, ExplorerProtocolDefinition>();
  /** Prefixes the selected network, as the rest of the explorer's links do. */
  private readonly relativeUrl = new RelativeUrlPipe();

  constructor(
    private api: UniverseApiService,
    private cd: ChangeDetectorRef,
    @Optional() private live?: UniverseWebsocketService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.reference && !changes.chain) {return;}
    this.events = [];
    this.nextCursor = null;
    this.eventsTotal = '0';
    this.polls = 0;
    if (!this.reference) {
      this.stop();
      this.state = { kind: 'idle' };
      return;
    }
    this.state = { kind: 'loading' };
    this.loadSummary();
    this.watchReorgs();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  refresh(): void {
    if (!this.reference) {return;}
    this.polls = 0;
    this.loadSummary();
  }

  applyFilters(): void {
    this.loadEvents(false);
  }

  clearFilters(): void {
    this.group = '';
    this.protocol = '';
    this.assetKind = '';
    this.txid = '';
    this.query = '';
    this.sort = 'tx';
    this.loadEvents(false);
  }

  loadMore(): void {
    if (this.nextCursor) {this.loadEvents(true);}
  }

  get summary(): BlockAssetActivitySummary | null {
    return this.state.kind === 'ready' ? this.state.summary : null;
  }

  notices(summary: BlockAssetActivitySummary): BlockCoverageNotice[] {
    return coverageNotices(summary);
  }

  breakdown(summary: BlockAssetActivitySummary): BlockProtocolCoverage[] {
    return breakdownRows(summary);
  }

  limits(summary: BlockAssetActivitySummary): BlockProtocolCoverage[] {
    return limitedRows(summary);
  }

  emptyMessage(summary: BlockAssetActivitySummary): string {
    return emptyStateMessage(summary);
  }

  /** Protocols worth offering as a filter: those with at least one record. */
  filterProtocols(summary: BlockAssetActivitySummary): BlockProtocolCoverage[] {
    return summary.protocols.filter((p) => p.eventCountAtomic !== '0');
  }

  progressPercent(summary: BlockAssetActivitySummary): number {
    const total = Number(summary.progress.totalTransactionsAtomic);
    if (!total) {return 0;}
    return Math.min(100, Math.floor((Number(summary.progress.processedTransactionsAtomic) / total) * 100));
  }

  count(value: string): string {
    return formatAtomicAmount(value);
  }

  badgeFor(protocolId: string, summary: BlockAssetActivitySummary | null): ExplorerProtocolDefinition {
    let badge = this.badges.get(protocolId);
    if (!badge) {
      const name = summary?.protocols.find((p) => p.protocolId === protocolId)?.displayName ?? protocolId;
      badge = { id: protocolId, shortName: name, displayName: name, visualToken: protocolId } as ExplorerProtocolDefinition;
      this.badges.set(protocolId, badge);
    }
    return badge;
  }

  assetLink(event: BlockAssetEvent): unknown[] | null {
    const route = assetRoute(this.chain, event.asset);
    return route ? this.relative(route) : null;
  }

  protocolLink(protocolId: string): unknown[] {
    return this.relative(protocolRoute(this.chain, protocolId));
  }

  txLink(txid: string): unknown[] {
    return this.relative(transactionRoute(this.chain, txid));
  }

  private relative(route: unknown[]): unknown[] {
    return [this.relativeUrl.transform(route[0] as string), ...route.slice(1)];
  }

  trackByEvent(_: number, event: BlockAssetEvent): string {
    return event.eventId;
  }

  trackByProtocol(_: number, row: BlockProtocolCoverage): string {
    return row.protocolId;
  }

  /**
   * A reorg that replaces this block, or that installs it, changes what the
   * page may claim, so the summary is read again; nothing else from the
   * live channel touches a confirmed block's records.
   */
  private watchReorgs(): void {
    this.liveSubscription?.unsubscribe();
    this.liveSubscription = null;
    if (!this.live) {return;}
    const chain = this.chain;
    this.liveSubscription = this.live.stream$(chain).pipe(
      filter((envelope) => envelope.channel === 'block-assets'),
    ).subscribe((envelope) => {
      const data = envelope.data as { reorged?: unknown } | null;
      const reorged = Array.isArray(data?.reorged) ? data.reorged : [];
      const hash = this.summary?.block.hash ?? this.reference;
      const touched = reorged.some((notice: { orphanedHash?: unknown; replacementHash?: unknown }) =>
        notice?.orphanedHash === hash || notice?.replacementHash === hash);
      const canonical = this.summary?.block.canonical;
      if (touched && chain === this.chain) {
        // A block already shown as replaced needs no second read.
        if (canonical === false && reorged.every((notice: { orphanedHash?: unknown }) => notice?.orphanedHash === hash)) {return;}
        this.refresh();
      }
    });
  }

  previewUrl(event: BlockAssetEvent): string | null {
    const summary = this.summary;
    const id = event.asset?.contentId ?? (event.asset?.assetKind === 'inscription' ? event.asset.assetId : undefined);
    if (!summary || !id || this.failedPreviews.has(id)) {return null;}
    if (event.protocolId !== 'ordinals' && event.protocolId !== 'doginals') {return null;}
    return this.api.inscriptionPreviewUrl(this.chain, summary.network, id);
  }

  previewFailed(event: BlockAssetEvent): void {
    const id = event.asset?.contentId ?? event.asset?.assetId;
    if (id) {this.failedPreviews.add(id);}
  }

  private stop(): void {
    this.liveSubscription?.unsubscribe();
    this.liveSubscription = null;
    this.summarySubscription?.unsubscribe();
    this.eventsSubscription?.unsubscribe();
    this.summarySubscription = null;
    this.eventsSubscription = null;
  }

  private loadSummary(): void {
    const reference = this.reference;
    this.summarySubscription?.unsubscribe();
    this.summarySubscription = this.api.getBlockAssetActivity$(this.chain, reference).subscribe({
      next: (summary) => {
        if (reference !== this.reference) {return;}
        this.state = { kind: 'ready', summary };
        this.loadEvents(false);
        if (summary.completeness === 'pending' && this.polls < MAX_POLLS) {
          this.polls += 1;
          this.summarySubscription = timer((summary.retryAfterSeconds ?? 3) * 1000)
            .subscribe(() => this.loadSummary());
        }
        this.cd.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        if (reference !== this.reference) {return;}
        this.state = {
          kind: 'error',
          reason: error?.status === 404 ? 'not-found' : error?.status === 503 ? 'unconfigured' : 'unavailable',
        };
        this.cd.markForCheck();
      },
    });
  }

  private loadEvents(append: boolean): void {
    const reference = this.reference;
    if (!reference) {return;}
    const query: BlockAssetEventQuery = {
      group: this.group || undefined,
      protocol: this.protocol || undefined,
      assetKind: this.assetKind || undefined,
      txid: this.txid.trim().toLowerCase() || undefined,
      q: this.query.trim() || undefined,
      sort: this.sort === 'tx' ? undefined : this.sort,
      limit: PAGE_SIZE,
      cursor: append ? this.nextCursor ?? undefined : undefined,
    };
    // A malformed txid filter is the reader's typo, not a server question.
    this.txidInvalid = query.txid !== undefined && !/^[0-9a-f]{64}$/.test(query.txid);
    if (this.txidInvalid) {
      this.events = [];
      this.nextCursor = null;
      this.eventsTotal = '0';
      this.cd.markForCheck();
      return;
    }
    this.eventsSubscription?.unsubscribe();
    this.eventsLoading = true;
    this.eventsFailed = false;
    this.cd.markForCheck();
    this.eventsSubscription = this.api.getBlockAssetEvents$(this.chain, reference, query).subscribe({
      next: (page) => {
        if (reference !== this.reference) {return;}
        this.events = append ? [...this.events, ...page.items] : page.items;
        this.nextCursor = page.nextCursor;
        this.eventsTotal = page.totalAtomic;
        this.eventsLoading = false;
        this.cd.markForCheck();
      },
      error: () => {
        if (reference !== this.reference) {return;}
        this.eventsLoading = false;
        this.eventsFailed = true;
        this.cd.markForCheck();
      },
    });
  }
}
