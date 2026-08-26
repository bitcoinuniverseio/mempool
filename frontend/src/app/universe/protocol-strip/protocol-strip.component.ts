import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, catchError, combineLatest, map, of } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { PulseState, UniversePulseService } from '@app/universe/universe-pulse.service';
import { ExplorerProtocolDefinition, ProtocolsResponse } from '@app/universe/universe.types';

interface StripEntry {
  readonly protocolId: string;
  readonly displayName: string;
  readonly count: number;
}

interface StripViewModel {
  readonly entries: readonly StripEntry[];
  readonly checked: number;
  readonly supportedCount: number;
  readonly authorityAnswering: boolean;
}

/**
 * The homepage answer to "what else does this explorer see".
 *
 * It is deliberately small: a first-time visitor should learn within a glance
 * that this explorer reads Bitcoin protocol assets, not read a dashboard about
 * it. Counts come from the same live sample the pulse page publishes, with the
 * same denominator, so the number on the homepage and the number on the pulse
 * page can never disagree.
 */
@Component({
  selector: 'app-universe-protocol-strip',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './protocol-strip.component.html',
  styleUrls: ['./protocol-strip.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProtocolStripComponent implements OnInit, OnDestroy {
  vm$: Observable<StripViewModel>;

  constructor(
    private api: UniverseApiService,
    private pulse: UniversePulseService,
  ) {}

  ngOnInit(): void {
    this.pulse.start();

    const registry$ = this.api.getProtocols$().pipe(
      catchError(() => of({ protocols: [] } as unknown as ProtocolsResponse)),
    );

    this.vm$ = combineLatest([registry$, this.pulse.state$]).pipe(
      map(([registry, pulse]): StripViewModel => {
        const supported = (registry.protocols || []).filter(isSupported);
        return {
          supportedCount: supported.length,
          checked: pulse.checked,
          authorityAnswering: pulse.authorityAnswering,
          entries: stripEntries(supported, pulse),
        };
      }),
    );
  }

  ngOnDestroy(): void {
    this.pulse.stop();
  }

  trackByEntry(index: number, entry: StripEntry): string {
    return entry.protocolId;
  }
}

function isSupported(protocol: ExplorerProtocolDefinition): boolean {
  const status = (protocol.releaseStatus || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  return (
    protocol.chain === 'bitcoin' &&
    (status === 'verified read only' || status === 'production verified')
  );
}

/** Supported protocols, busiest first, each with its exact live count. */
export function stripEntries(
  supported: readonly ExplorerProtocolDefinition[],
  pulse: PulseState,
): StripEntry[] {
  return supported
    .map((protocol) => ({
      protocolId: protocol.id,
      displayName: protocol.shortName || protocol.displayName || protocol.id,
      count: pulse.protocolCounts.get(protocol.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));
}
