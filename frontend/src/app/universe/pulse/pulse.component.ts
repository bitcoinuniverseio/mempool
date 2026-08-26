import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, catchError, combineLatest, map, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { WebsocketService } from '@app/services/websocket.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { PulseEvent, PulseState, UniversePulseService } from '@app/universe/universe-pulse.service';
import {
  ExplorerProtocolDefinition,
  ProtocolsResponse,
  SourceEntry,
  SourcesResponse,
} from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';

interface ProtocolShare {
  readonly protocolId: string;
  readonly displayName: string;
  readonly count: number;
  /** Whole percent of checked transactions. Never rounded up from zero. */
  readonly percent: number;
}

interface PulseViewModel {
  readonly pulse: PulseState;
  readonly shares: readonly ProtocolShare[];
  readonly names: ReadonlyMap<string, string>;
  readonly sources: readonly SourceEntry[] | null;
}

/**
 * Live protocol activity, measured rather than asserted.
 *
 * The page states exactly what it sampled and how it counted, because a
 * "trending protocol" that cannot be reproduced from published numbers is
 * decoration. Everything shown here is derived from transactions the asset
 * authority answered for since the page opened.
 */
@Component({
  selector: 'app-universe-pulse',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './pulse.component.html',
  styleUrls: ['./pulse.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PulseComponent implements OnInit, OnDestroy {
  vm$: Observable<PulseViewModel>;
  readonly shorten = shortenIdentifier;

  constructor(
    private pulse: UniversePulseService,
    private api: UniverseApiService,
    private websocketService: WebsocketService,
    private seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.seo.setTitle('Live protocol activity');
    // The pulse reads the same mempool feed the dashboard uses, so the socket
    // subscription is the ordinary one, not a new channel.
    this.websocketService.want(['blocks', 'stats', 'mempool-blocks']);
    this.pulse.start();

    const names$ = this.api.getProtocols$().pipe(
      map((response: ProtocolsResponse) => nameIndex(response.protocols || [])),
      catchError(() => of(new Map<string, string>())),
    );
    const sources$ = this.api.getSources$().pipe(
      map((response: SourcesResponse) => response.sources || []),
      catchError(() => of(null)),
    );

    this.vm$ = combineLatest([this.pulse.state$, names$, sources$]).pipe(
      map(([pulse, names, sources]): PulseViewModel => ({
        pulse,
        names,
        sources,
        shares: sharesOf(pulse, names),
      })),
    );
  }

  ngOnDestroy(): void {
    this.pulse.stop();
  }

  actionSummary(event: PulseEvent): string {
    if (!event.actions?.length) {
      return $localize`:@@universe.pulse.holds-assets:Moves assets`;
    }
    const types = [...new Set(event.actions.map((action) => action.actionType).filter(Boolean))];
    return types.join(', ');
  }

  statusLabel(event: PulseEvent): string {
    switch (event.status) {
      case 'mempool-candidate':
        return $localize`:@@universe.pulse.status-pending:Pending`;
      case 'confirmed':
        return $localize`:@@universe.pulse.status-confirmed:Confirmed`;
      case 'replaced':
        return $localize`:@@universe.pulse.status-replaced:Replaced`;
      case 'orphaned':
        return $localize`:@@universe.pulse.status-orphaned:Orphaned`;
      default:
        return $localize`:@@universe.pulse.status-enriching:Reading evidence`;
    }
  }

  statusTone(event: PulseEvent): string {
    switch (event.status) {
      case 'confirmed': return 'proven';
      case 'mempool-candidate': return 'pending';
      case 'replaced':
      case 'orphaned': return 'unavailable';
      default: return 'partial';
    }
  }

  readySourceCount(sources: readonly SourceEntry[] | null): number {
    return (sources || []).filter((source) => source.ready).length;
  }

  trackByShare(index: number, share: ProtocolShare): string {
    return share.protocolId;
  }

  trackByEvent(index: number, event: PulseEvent): string {
    return event.txid;
  }
}

function nameIndex(protocols: readonly ExplorerProtocolDefinition[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const protocol of protocols) {
    names.set(protocol.id, protocol.shortName || protocol.displayName || protocol.id);
  }
  return names;
}

/**
 * Percentages are floored, so a protocol seen in a handful of transactions
 * reads as the small share it is instead of being rounded up into significance.
 */
export function sharesOf(
  pulse: PulseState,
  names: ReadonlyMap<string, string>,
): ProtocolShare[] {
  const shares: ProtocolShare[] = [];
  for (const [protocolId, count] of pulse.protocolCounts) {
    shares.push({
      protocolId,
      count,
      displayName: names.get(protocolId) || protocolId,
      percent: pulse.checked > 0 ? Math.floor((count * 100) / pulse.checked) : 0,
    });
  }
  return shares.sort((a, b) => b.count - a.count || a.protocolId.localeCompare(b.protocolId));
}
