import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, catchError, combineLatest, map, of, shareReplay, startWith, switchMap, take, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { PulseEvent, PulseState, UniversePulseService } from '@app/universe/universe-pulse.service';
import { ProtocolCopy, protocolCopy } from '@app/universe/universe-protocol-copy';
import {
  ExplorerProtocolActivityPage,
  ExplorerProtocolDefinition,
  ExplorerProtocolObjectsPage,
  ProtocolCoverage,
  SourceEntry,
} from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';
import {
  ProtocolAvailability,
  availabilityLabel,
  normalizeReleaseStatus,
  protocolAvailability,
  sourceForProtocol,
} from '@app/universe/protocol-availability';
import {
  ProtocolActivityRow,
  ProtocolObjectRow,
  activitySummary,
  objectsSummary,
  readActivityRows,
  readObjectRows,
} from '@app/universe/protocol-activity-view';

interface ProtocolActivityState {
  readonly kind: 'idle' | 'loading' | 'error' | 'loaded';
  readonly page?: ExplorerProtocolActivityPage;
  readonly rows?: readonly ProtocolActivityRow[];
  readonly summary?: string;
  readonly loadingMore?: boolean;
  readonly loadMoreError?: string;
}

interface ProtocolObjectsState {
  readonly kind: 'idle' | 'loading' | 'error' | 'loaded';
  readonly page?: ExplorerProtocolObjectsPage;
  readonly rows?: readonly ProtocolObjectRow[];
  readonly summary?: string;
  readonly loadingMore?: boolean;
  readonly loadMoreError?: string;
}

interface ProtocolDetailViewModel {
  readonly kind: 'loading' | 'ready' | 'missing' | 'error';
  readonly protocol?: ExplorerProtocolDefinition;
  readonly copy?: ProtocolCopy;
  readonly source?: SourceEntry | null;
  /** null when the authority snapshot could not be read at all. */
  readonly sourcesByAuthority?: ReadonlyMap<string, SourceEntry> | null;
  /** What the authority can answer for right now; the primary label. */
  readonly availability?: ProtocolAvailability;
  /** True only when the authority behind this protocol can answer right now. */
  readonly live?: boolean;
  readonly onThisChain?: boolean;
  readonly pulse?: PulseState;
  readonly events?: readonly PulseEvent[];
  readonly pinned?: boolean;
}

/**
 * The outcome of resolving the route's protocol id against the registry.
 * A registry outage is its own outcome: it is never reported as a missing
 * protocol, and it is caught inside the attempt so the route stream that
 * carries the next navigation is never terminated by it.
 */
export type ProtocolResolution =
  | { readonly kind: 'loading' }
  | { readonly kind: 'registry-error' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'found'; readonly protocol: ExplorerProtocolDefinition };

/**
 * One protocol, explained and evidenced.
 *
 * The page has to be equally clear when a protocol is fully supported and when
 * it is not. A registry entry with no running authority is described as
 * exactly that, and never dressed up as live coverage.
 */
@Component({
  selector: 'app-protocol-detail',
  templateUrl: './protocol-detail.component.html',
  styleUrls: ['./protocol-detail.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProtocolDetailComponent implements OnInit, OnDestroy {
  vm$: Observable<ProtocolDetailViewModel>;
  readonly shorten = shortenIdentifier;
  readonly notConfiguredLabel = $localize`:@@universe.detail.authority-none:Not configured here`;

  readonly activity$ = new BehaviorSubject<ProtocolActivityState>({ kind: 'idle' });
  private activityCursor: string | null = null;
  private activityPages: ExplorerProtocolActivityPage[] = [];
  private activitySubscription?: Subscription;

  readonly objects$ = new BehaviorSubject<ProtocolObjectsState>({ kind: 'idle' });
  private objectCursor: string | null = null;
  private objectPages: ExplorerProtocolObjectsPage[] = [];
  private objectSubscription?: Subscription;
  private protocolChain = 'bitcoin';
  /** Re-reads the registry for the current route after a registry failure. */
  private readonly registryRetry$ = new BehaviorSubject<number>(0);

  constructor(
    private route: ActivatedRoute,
    private api: UniverseApiService,
    private pulse: UniversePulseService,
    private local: UniverseLocalService,
    private seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.pulse.start();

    // The protocol resolves once per navigation, and again per Retry click
    // after a registry failure. Title and history are recorded there, not in
    // the live stream below, so a ticking pulse never re-runs a page-level
    // side effect. Each resolution attempt is cancelled by the next one, so a
    // late registry answer cannot paint a protocol the route has left; the
    // registry re-emits on a network switch, which reaches the same path.
    const protocol$ = combineLatest([this.route.paramMap, this.registryRetry$]).pipe(
      switchMap(([params]) => {
        const id = (params.get('id') || '').toLowerCase();
        return this.api.getProtocols$().pipe(
          map((registry): ProtocolResolution => {
            const protocol = findProtocol(registry.protocols || [], id);
            return protocol ? { kind: 'found', protocol } : { kind: 'missing' };
          }),
          catchError(() => of<ProtocolResolution>({ kind: 'registry-error' })),
          startWith<ProtocolResolution>({ kind: 'loading' }),
        );
      }),
      tap((resolution) => {
        // Whatever the outcome, reads for the previous protocol or network
        // are cancelled so they cannot land on this one.
        this.activitySubscription?.unsubscribe();
        this.objectSubscription?.unsubscribe();
        if (resolution.kind !== 'found') {
          const state = resolution.kind === 'loading' ? 'loading' : 'idle';
          this.activity$.next({ kind: state });
          this.objects$.next({ kind: state });
          return;
        }
        const protocol = resolution.protocol;
        this.protocolChain = protocol.chain;
        this.seo.setTitle(protocol.displayName);
        this.local.recordVisit({
          kind: 'protocol',
          value: protocol.id,
          path: `/protocols/${protocol.id}`,
          label: protocol.displayName,
        });
        this.loadActivity(protocol.id);
        this.loadObjects(protocol.id);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.vm$ = protocol$.pipe(
      switchMap((resolution) => {
        if (resolution.kind === 'loading') {
          return of<ProtocolDetailViewModel>({ kind: 'loading' });
        }
        if (resolution.kind === 'registry-error') {
          return of<ProtocolDetailViewModel>({ kind: 'error' });
        }
        if (resolution.kind === 'missing') {
          return of<ProtocolDetailViewModel>({ kind: 'missing' });
        }
        const protocol = resolution.protocol;
        return combineLatest([
          this.api.getSources$(protocol.chain).pipe(
            map((response): ReadonlyMap<string, SourceEntry> | null =>
              Array.isArray(response?.sources)
                ? new Map(response.sources.map((entry) => [entry.authorityId, entry]))
                : null),
            // A snapshot that could not be read leaves availability unknown;
            // it is not an empty snapshot, which would read as unconfigured.
            catchError(() => of(null)),
          ),
          this.pulse.state$,
          this.local.preferences$,
        ]).pipe(
          map(([sourcesByAuthority, pulse, preferences]): ProtocolDetailViewModel => {
            const availability = protocolAvailability(protocol, sourcesByAuthority);
            return {
              kind: 'ready',
              protocol,
              copy: protocolCopy(protocol.id, protocol.family),
              source: sourceForProtocol(protocol, sourcesByAuthority),
              sourcesByAuthority,
              availability,
              live: availability === 'available',
              onThisChain: protocol.chain === 'bitcoin',
              pulse,
              events: pulse.recent.filter((event) => event.protocolIds.includes(protocol.id)),
              pinned: preferences.pinnedProtocols.includes(protocol.id),
            };
          }),
          catchError(() => of<ProtocolDetailViewModel>({ kind: 'error' })),
        );
      }),
    );
  }

  /** Re-reads the registry for the current route, cancelling any attempt in flight. */
  retryRegistry(): void {
    this.registryRetry$.next(this.registryRetry$.value + 1);
  }

  ngOnDestroy(): void {
    this.activitySubscription?.unsubscribe();
    this.objectSubscription?.unsubscribe();
    this.pulse.stop();
  }

  /**
   * Reads the protocol's authority feed, first page. Every terminal state
   * resolves to a page the template can state truthfully; transport and
   * invalid document failures land here as an error with an explicit retry.
   */
  loadActivity(protocolId: string): void {
    this.activitySubscription?.unsubscribe();
    this.activityPages = [];
    this.activityCursor = null;
    this.activity$.next({ kind: 'loading' });
    this.activitySubscription = this.api.getProtocolActivity$(protocolId, undefined, 25, this.protocolChain).pipe(take(1)).subscribe({
      next: (page) => this.pushActivityPage(page),
      error: () => this.activity$.next({ kind: 'error' }),
    });
  }

  /** Appends the next cursor page of the same feed. */
  loadMoreActivity(protocolId: string): void {
    const state = this.activity$.value;
    if (state.kind !== 'loaded' || !this.activityCursor || state.loadingMore) {
      return;
    }
    this.activity$.next({ ...state, loadingMore: true, loadMoreError: undefined });
    const failed = (reason = $localize`:@@universe.detail.activity-page-failed:The next activity page could not be read. Try again.`): void => {
      this.activity$.next({ ...state, loadingMore: false, loadMoreError: reason });
    };
    this.activitySubscription = this.api.getProtocolActivity$(protocolId, this.activityCursor, 25, this.protocolChain).pipe(take(1)).subscribe({
      next: (page) => page.state === 'served' ? this.pushActivityPage(page) : failed(page.degradedReason ?? undefined),
      error: () => failed(),
    });
  }

  private pushActivityPage(page: ExplorerProtocolActivityPage): void {
    this.activityPages.push(page);
    this.activityCursor = page.hasMore ? page.nextCursor : null;
    const merged = {
      events: this.activityPages.flatMap((entry) => entry.events),
      assets: this.activityPages.flatMap((entry) => entry.assets),
      invalidations: this.activityPages.flatMap((entry) => entry.invalidations),
    };
    const latest = this.activityPages[this.activityPages.length - 1];
    this.activity$.next({
      kind: 'loaded',
      page: { ...latest, ...merged, hasMore: latest.hasMore },
      rows: readActivityRows([...merged.events, ...merged.invalidations]),
      summary: activitySummary(latest),
      loadingMore: false,
    });
  }

  /**
   * Reads the protocol's authority objects, first page, on the same terms
   * as the activity feed above.
   */
  loadObjects(protocolId: string): void {
    this.objectSubscription?.unsubscribe();
    this.objectPages = [];
    this.objectCursor = null;
    this.objects$.next({ kind: 'loading' });
    this.objectSubscription = this.api.getProtocolObjects$(protocolId, undefined, 25, this.protocolChain).pipe(take(1)).subscribe({
      next: (page) => this.pushObjectsPage(page),
      error: () => this.objects$.next({ kind: 'error' }),
    });
  }

  loadMoreObjects(protocolId: string): void {
    const state = this.objects$.value;
    if (state.kind !== 'loaded' || !this.objectCursor || state.loadingMore) {
      return;
    }
    this.objects$.next({ ...state, loadingMore: true, loadMoreError: undefined });
    const failed = (reason = $localize`:@@universe.detail.objects-page-failed:The next objects page could not be read. Try again.`): void => {
      this.objects$.next({ ...state, loadingMore: false, loadMoreError: reason });
    };
    this.objectSubscription = this.api.getProtocolObjects$(protocolId, this.objectCursor, 25, this.protocolChain).pipe(take(1)).subscribe({
      next: (page) => page.state === 'served' ? this.pushObjectsPage(page) : failed(page.degradedReason ?? undefined),
      error: () => failed(),
    });
  }

  private pushObjectsPage(page: ExplorerProtocolObjectsPage): void {
    this.objectPages.push(page);
    this.objectCursor = page.state === 'served' && page.nextCursor ? page.nextCursor : null;
    const merged = {
      items: this.objectPages.flatMap((entry) => entry.items),
      nextCursor: page.nextCursor,
    };
    const latest = this.objectPages[this.objectPages.length - 1];
    const served: ExplorerProtocolObjectsPage = {
      ...latest,
      items: merged.items,
      nextCursor: merged.nextCursor,
    };
    this.objects$.next({
      kind: 'loaded',
      page: served,
      rows: readObjectRows(merged.items),
      summary: objectsSummary(latest, merged.items.length),
      loadingMore: false,
    });
  }

  objectsSummaryLabel(state: ProtocolObjectsState): string | null {
    return state.kind === 'loaded' ? state.summary : null;
  }

  trackByObject(index: number, row: ProtocolObjectRow): string {
    return row.id ?? `${index}`;
  }

  activitySummaryLabel(state: ProtocolActivityState): string | null {
    return state.kind === 'loaded' ? state.summary : null;
  }

  trackByRow(index: number, row: ProtocolActivityRow): string {
    return row.id ?? `${index}`;
  }

  togglePin(protocolId: string): void {
    this.local.togglePinnedProtocol(protocolId);
  }

  /** The primary label: what the authority can answer for right now. */
  availabilityLabel(availability: ProtocolAvailability): string {
    return availabilityLabel(availability);
  }

  availabilityTone(availability: ProtocolAvailability): string {
    switch (availability) {
      case 'available': return 'proven';
      case 'catching-up': return 'partial';
      case 'degraded':
      case 'unreachable': return 'unavailable';
      default: return 'neutral';
    }
  }

  /** The registry release status, a qualifier beside the availability label. */
  statusLabel(protocol: ExplorerProtocolDefinition): string {
    switch (normalizeReleaseStatus(protocol)) {
      case 'production verified':
      case 'verified read only':
        return $localize`:@@universe.detail.status-live:Readable in this explorer`;
      case 'blocked':
        return $localize`:@@universe.detail.status-blocked:Not readable here yet`;
      case 'intentionally disabled':
        return $localize`:@@universe.detail.status-disabled:Deliberately turned off`;
      default:
        return $localize`:@@universe.detail.status-unknown:Support status unknown`;
    }
  }

  /**
   * Says what is actually missing, so a blocked entry is never a mystery.
   * The current authority state decides, not the release status: a verified
   * reader whose authority is unreachable or behind is still not readable.
   */
  limitation(vm: ProtocolDetailViewModel): string | null {
    if (!vm.onThisChain) {
      return $localize`:@@universe.detail.other-chain:This protocol lives on ${vm.protocol.chain}:chain:, which this explorer does not serve. It is listed so the registry stays complete, not because it is readable here.`;
    }
    switch (vm.availability) {
      case 'available':
        return null;
      case 'disabled':
        return $localize`:@@universe.detail.disabled:This protocol is deliberately turned off in this deployment, so no protocol state is shown for it.`;
      case 'unconfigured':
        return $localize`:@@universe.detail.no-authority:No first-party authority for this protocol is configured in this deployment, so the explorer makes no claim about it. Nothing is inferred from transaction shape to fill the gap.`;
      case 'unreachable':
        return $localize`:@@universe.detail.authority-unreachable:The authority for this protocol is configured but not answering, so no protocol state is shown for it.`;
      case 'catching-up':
        return $localize`:@@universe.detail.authority-catching-up:The authority for this protocol is still catching up with the chain, so its state is behind and is not called readable yet.`;
      case 'degraded':
        return $localize`:@@universe.detail.authority-degraded:The authority for this protocol answered without a checkpoint, so nothing it reports can be proven against the chain right now.`;
      case 'unknown':
        if (vm.sourcesByAuthority === null) {
          return $localize`:@@universe.detail.authority-unknown:The authority status for this protocol could not be read, so the explorer does not call it readable right now.`;
        }
        return $localize`:@@universe.detail.status-unknown-limitation:The registry does not state what this protocol implements here, so the explorer makes no claim about it.`;
      default:
        return $localize`:@@universe.detail.adapter-pending:The authority is reachable, but the explorer's reader for this protocol is not finished, so its state is not shown yet.`;
    }
  }

  coverageLabel(protocol: ExplorerProtocolDefinition): string | null {
    const coverage = protocol.coverage;
    if (!coverage) {return null;}
    if (typeof coverage === 'string') {return coverage;}
    return (coverage as ProtocolCoverage).state ?? null;
  }

  liveCount(vm: ProtocolDetailViewModel): number {
    return vm.pulse?.protocolCounts.get(vm.protocol.id) ?? 0;
  }

  trackByEvent(index: number, event: PulseEvent): string {
    return event.txid;
  }
}

/** Matches on id first, then on any alias, so old links keep working. */
export function findProtocol(
  protocols: readonly ExplorerProtocolDefinition[],
  id: string,
): ExplorerProtocolDefinition | null {
  if (!id) {return null;}
  const exact = protocols.find((protocol) => protocol.id === id);
  if (exact) {return exact;}
  return protocols.find((protocol) => (protocol.aliases || []).includes(id)) ?? null;
}
