import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, catchError, combineLatest, map, of } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { PulseObservation, PulseState, UniversePulseService } from '@app/universe/universe-pulse.service';
import { ExplorerProtocolDefinition, ProtocolsResponse } from '@app/universe/universe.types';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

interface StripEntry {
  readonly protocolId: string;
  readonly displayName: string;
  /** Exact count within the sample, or null when there is no sample to count in. */
  readonly count: number | null;
}

interface StripViewModel {
  readonly entries: readonly StripEntry[];
  readonly checked: number;
  readonly supportedCount: number;
  readonly observation: PulseObservation;
  /** When the sample was last extended; shown when the tally is stale. */
  readonly lastSampleAt: number | null;
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
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
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
          observation: pulse.observation,
          lastSampleAt: pulse.lastSampleAt,
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

/**
 * Supported protocols, busiest first, each with its exact count within the
 * sample. Before the authority has resolved anything there is no sample, so
 * every count is null rather than a zero nobody measured; a stale sample
 * keeps its counts, and the note beside it says how old they are.
 */
export function stripEntries(
  supported: readonly ExplorerProtocolDefinition[],
  pulse: PulseState,
): StripEntry[] {
  const sampled = pulse.observation === 'observed' || pulse.observation === 'stale';
  return supported
    .map((protocol) => ({
      protocolId: protocol.id,
      displayName: protocol.shortName || protocol.displayName || protocol.id,
      count: sampled ? pulse.protocolCounts.get(protocol.id) ?? 0 : null,
    }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.displayName.localeCompare(b.displayName));
}
