import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, catchError, combineLatest, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { PulseEvent, PulseState, UniversePulseService } from '@app/universe/universe-pulse.service';
import { ProtocolCopy, protocolCopy } from '@app/universe/universe-protocol-copy';
import {
  ExplorerProtocolDefinition,
  ProtocolCoverage,
  SourceEntry,
} from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';

interface ProtocolDetailViewModel {
  readonly kind: 'loading' | 'ready' | 'missing' | 'error';
  readonly protocol?: ExplorerProtocolDefinition;
  readonly copy?: ProtocolCopy;
  readonly source?: SourceEntry | null;
  readonly live?: boolean;
  readonly onThisChain?: boolean;
  readonly pulse?: PulseState;
  readonly events?: readonly PulseEvent[];
  readonly pinned?: boolean;
}

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

  constructor(
    private route: ActivatedRoute,
    private api: UniverseApiService,
    private pulse: UniversePulseService,
    private local: UniverseLocalService,
    private seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.pulse.start();

    const sources$ = this.api.getSources$().pipe(
      map((response) => response.sources || []),
      catchError(() => of([] as SourceEntry[])),
    );

    // The protocol itself resolves once per navigation. Title and history are
    // recorded there, not in the live stream below, so a ticking pulse never
    // re-runs a page-level side effect.
    const protocol$ = this.route.paramMap.pipe(
      switchMap((params) => {
        const id = (params.get('id') || '').toLowerCase();
        return this.api.getProtocols$().pipe(
          map((registry) => findProtocol(registry.protocols || [], id)),
        );
      }),
      tap((protocol) => {
        if (!protocol) {return;}
        this.seo.setTitle(protocol.displayName);
        this.local.recordVisit({
          kind: 'protocol',
          value: protocol.id,
          path: `/protocols/${protocol.id}`,
          label: protocol.displayName,
        });
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.vm$ = protocol$.pipe(
      switchMap((protocol) => {
        if (!protocol) {
          return of<ProtocolDetailViewModel>({ kind: 'missing' });
        }
        return combineLatest([
          sources$,
          this.pulse.state$,
          this.local.preferences$,
        ]).pipe(
          map(([sources, pulse, preferences]): ProtocolDetailViewModel => {
            return {
              kind: 'ready',
              protocol,
              copy: protocolCopy(protocol.id, protocol.family),
              source: sources.find((entry) => entry.authorityId === protocol.indexerAuthority) ?? null,
              live: isLive(protocol),
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

  ngOnDestroy(): void {
    this.pulse.stop();
  }

  togglePin(protocolId: string): void {
    this.local.togglePinnedProtocol(protocolId);
  }

  statusLabel(protocol: ExplorerProtocolDefinition): string {
    switch (normalizeStatus(protocol)) {
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

  statusTone(protocol: ExplorerProtocolDefinition): string {
    return isLive(protocol) ? 'proven' : 'partial';
  }

  /** Says what is actually missing, so a blocked entry is never a mystery. */
  limitation(vm: ProtocolDetailViewModel): string | null {
    if (!vm.onThisChain) {
      return $localize`:@@universe.detail.other-chain:This protocol lives on ${vm.protocol.chain}:chain:, which this explorer does not serve. It is listed so the registry stays complete, not because it is readable here.`;
    }
    if (vm.live) {return null;}
    if (!vm.source || vm.source.status === 'unconfigured') {
      return $localize`:@@universe.detail.no-authority:No first-party authority for this protocol is configured in this deployment, so the explorer makes no claim about it. Nothing is inferred from transaction shape to fill the gap.`;
    }
    if (vm.source.status === 'unreachable') {
      return $localize`:@@universe.detail.authority-unreachable:The authority for this protocol is configured but not answering, so no protocol state is shown for it.`;
    }
    return $localize`:@@universe.detail.adapter-pending:The authority is reachable, but the explorer's reader for this protocol is not finished, so its state is not shown yet.`;
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

function normalizeStatus(protocol: ExplorerProtocolDefinition): string {
  return (protocol.releaseStatus || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
}

function isLive(protocol: ExplorerProtocolDefinition): boolean {
  const status = normalizeStatus(protocol);
  return status === 'verified read only' || status === 'production verified';
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
