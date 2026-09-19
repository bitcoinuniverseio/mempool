import { Component, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of, startWith, switchMap, timeout } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  ExplorerNetwork,
  ExplorerProtocolDefinition,
  ProtocolCoverage,
  ProtocolsResponse,
  SourceEntry,
  SourcesResponse,
} from '@app/universe/universe.types';
import { SeoService } from '@app/services/seo.service';
import {
  ProtocolAvailability,
  availabilityLabel,
  hasReadOperations,
  normalizeReleaseStatus,
  protocolAvailability,
  sourceForProtocol,
} from '@app/universe/protocol-availability';

export type { ProtocolAvailability } from '@app/universe/protocol-availability';

interface FamilyGroup {
  family: string;
  label: string;
  protocols: ExplorerProtocolDefinition[];
}

export interface DirectoryViewModel {
  loading: boolean;
  error: boolean;
  /** The network the registry request was addressed to; what the copy names. */
  network: ExplorerNetwork;
  registryVersion?: string;
  groups?: FamilyGroup[];
  otherChainCount?: number;
  liveCount?: number;
  totalCount?: number;
  /** null when the source snapshot could not be read; the page still renders. */
  sourcesByAuthority?: Map<string, SourceEntry> | null;
}

/** How long the page waits for the registry before saying it could not load. */
const REQUEST_TIMEOUT_MS = 20_000;

// display order of protocol families; unknown families sort after the known
// ones and before OTHER
const FAMILY_ORDER = ['ORDINALS', 'RUNES', 'ALKANES', 'STAMPS', 'ATOMICALS', 'OP DATA', 'OTHER'];

@Component({
  selector: 'app-protocol-directory',
  templateUrl: './protocol-directory.component.html',
  styleUrls: ['./protocol-directory.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProtocolDirectoryComponent implements OnInit {
  vm$: Observable<DirectoryViewModel>;
  skeletonRows = new Array(6);
  private retry$ = new BehaviorSubject<number>(0);

  constructor(
    private universeApiService: UniverseApiService,
    private seoService: SeoService,
  ) { }

  ngOnInit(): void {
    this.seoService.setTitle('Universe Protocols');
    // The registry is the page; the live source snapshot only annotates it, so
    // a failing snapshot must not blank out the directory.
    //
    // Every attempt, including the one a Retry click starts, is its own inner
    // stream: it announces loading, resolves to a page or to the error state,
    // and is cancelled by the next attempt. The error is caught inside the
    // attempt, so the retry stream outlives a failed registry read. Catching
    // it outside completed the whole subscription on the first failure, and
    // the Retry button then emitted to nothing.
    this.vm$ = this.retry$.pipe(
      switchMap(() => this.universeApiService.selectedNetwork$().pipe(
        switchMap((network) => this.attempt(network)),
        // The network stream itself refuses a network the overlay does not serve.
        catchError(() => of(this.errorModel(this.fallbackNetwork()))),
      )),
    );
  }

  /** One read of the registry and the authority snapshot for one network. */
  private attempt(network: ExplorerNetwork): Observable<DirectoryViewModel> {
    return combineLatest([
      // A request that hangs is the failure this page had left: the registry
      // never arrived, nothing errored, and the skeleton stayed on screen
      // with nothing subscribed to clear it. The budget turns that into the
      // error state below, which says so and offers a retry.
      this.universeApiService.getProtocols$().pipe(timeout({ first: REQUEST_TIMEOUT_MS })),
      this.universeApiService.getSources$().pipe(
        timeout({ first: REQUEST_TIMEOUT_MS }),
        catchError(() => of(null)),
      ),
    ]).pipe(
      map(([response, sources]: [ProtocolsResponse, SourcesResponse | null]): DirectoryViewModel => {
        const bitcoinProtocols = (response.protocols || []).filter(p => p.chain === 'bitcoin');
        const otherChainCount = (response.protocols || []).length - bitcoinProtocols.length;
        const sourcesByAuthority = this.indexSources(sources);
        return {
          loading: false,
          error: false,
          network,
          registryVersion: response.registryVersion,
          groups: this.groupByFamily(bitcoinProtocols),
          otherChainCount,
          liveCount: bitcoinProtocols.filter(p => this.isLive(p, sourcesByAuthority)).length,
          totalCount: bitcoinProtocols.length,
          sourcesByAuthority,
        };
      }),
      catchError(() => of(this.errorModel(network))),
      startWith<DirectoryViewModel>({ loading: true, error: false, network }),
    );
  }

  private errorModel(network: ExplorerNetwork): DirectoryViewModel {
    return { loading: false, error: true, network };
  }

  /** The label network when the overlay refused the selected one. */
  private fallbackNetwork(): ExplorerNetwork {
    try {
      return this.universeApiService.network;
    } catch {
      return 'mainnet';
    }
  }

  /** The Bitcoin network the registry was read from, as the copy names it. */
  networkLabel(network: ExplorerNetwork): string {
    switch (network) {
      case 'signet': return $localize`:@@universe.protocols.network-signet:Bitcoin Signet`;
      case 'testnet': return $localize`:@@universe.protocols.network-testnet:Bitcoin Testnet`;
      case 'testnet4': return $localize`:@@universe.protocols.network-testnet4:Bitcoin Testnet4`;
      case 'regtest': return $localize`:@@universe.protocols.network-regtest:Bitcoin Regtest`;
      default: return $localize`:@@universe.protocols.network-mainnet:Bitcoin mainnet`;
    }
  }

  private indexSources(sources: SourcesResponse | null): Map<string, SourceEntry> | null {
    if (!sources || !Array.isArray(sources.sources)) {
      return null;
    }
    return new Map(sources.sources.map(entry => [entry.authorityId, entry]));
  }

  private normalizeFamily(family: string): string {
    return (family || 'OTHER').toUpperCase().replace(/[_-]+/g, ' ').trim();
  }

  private groupByFamily(protocols: ExplorerProtocolDefinition[]): FamilyGroup[] {
    const groups = new Map<string, FamilyGroup>();
    for (const protocol of protocols) {
      const label = this.normalizeFamily(protocol.family);
      if (!groups.has(label)) {
        groups.set(label, { family: protocol.family, label, protocols: [] });
      }
      groups.get(label).protocols.push(protocol);
    }
    const orderOf = (label: string): number => {
      const index = FAMILY_ORDER.indexOf(label);
      if (index >= 0) {
        return index;
      }
      return FAMILY_ORDER.length; // unknown families before OTHER
    };
    return Array.from(groups.values()).sort((a, b) => {
      const aOrder = a.label === 'OTHER' ? FAMILY_ORDER.length + 1 : orderOf(a.label);
      const bOrder = b.label === 'OTHER' ? FAMILY_ORDER.length + 1 : orderOf(b.label);
      return aOrder - bOrder || a.label.localeCompare(b.label);
    });
  }

  private humanize(value: string): string {
    const cleaned = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  private normalizeStatus(protocol: ExplorerProtocolDefinition): string {
    return normalizeReleaseStatus(protocol);
  }

  /**
   * What this protocol can answer for right now.
   *
   * The registry says what a protocol is implemented to do; the source
   * snapshot says whether the authority behind it can answer at all. Those
   * were rendered as two chips of equal weight, so a protocol whose authority
   * was unreachable still led with "Live, read only" and read as working.
   * Availability decides the primary label, and the registry capability is
   * carried underneath it. The rule itself is shared with the detail page.
   */
  availability(
    protocol: ExplorerProtocolDefinition,
    sources: Map<string, SourceEntry> | null,
  ): ProtocolAvailability {
    return protocolAvailability(protocol, sources);
  }

  /** Whether the registry declares a reader beyond the registry entry itself. */
  hasReadOperations(protocol: ExplorerProtocolDefinition): boolean {
    return hasReadOperations(protocol);
  }

  /** True only when the authority behind this protocol can answer right now. */
  isLive(
    protocol: ExplorerProtocolDefinition,
    sources: Map<string, SourceEntry> | null,
  ): boolean {
    return this.availability(protocol, sources) === 'available';
  }

  availabilityLabel(availability: ProtocolAvailability): string {
    return availabilityLabel(availability);
  }

  availabilityClass(availability: ProtocolAvailability): string {
    switch (availability) {
      case 'available': return 'chip-live';
      case 'catching-up': return 'chip-partial';
      case 'degraded':
      case 'unreachable': return 'chip-blocked';
      case 'not-implemented':
      case 'unconfigured': return 'chip-unknown';
      case 'disabled': return 'chip-disabled';
      default: return 'chip-unknown';
    }
  }

  /**
   * The registry capability, phrased as what the protocol would do once its
   * authority can answer. It is never the primary label.
   */
  capabilityLabel(protocol: ExplorerProtocolDefinition): string {
    switch (this.normalizeStatus(protocol)) {
      case 'production verified': return $localize`:@@universe.protocols.capability-production:Read and verify`;
      case 'verified read only': return $localize`:@@universe.protocols.capability-read-only:Read only`;
      case 'blocked':
        return this.hasReadOperations(protocol)
          ? $localize`:@@universe.protocols.capability-unverified:Read only, not verified`
          : $localize`:@@universe.protocols.capability-blocked:Not implemented`;
      case 'intentionally disabled': return $localize`:@@universe.protocols.capability-disabled:Disabled`;
      case '': return $localize`:@@universe.protocols.capability-unknown:Capability unknown`;
      default: return this.humanize(this.normalizeStatus(protocol));
    }
  }

  /**
   * IMPLEMENTATION-HANDOFF [FE-COVERAGE-01] | all protocol/operation coverage rows.
   * Verified: this label trusts coverage from the registry, although the pinned
   * manifest has 123 NOT TESTED descriptors and seven historical complete rows.
   * Prerequisite: backend acceptance schema and evidence gate (BE work packages).
   * 1. Add a typed, network/revision-bound acceptance summary to universe.types.ts
   *    after its backend contract is agreed; keep runtime readiness independent.
   * 2. Derive completion from passed/applicable operation counts with evidence,
   *    never from source ready, a checkpoint, HTTP 200, or a historical string.
   *    Missing evidence and a zero/unknown denominator must remain unverified.
   * 3. Share derivation with ProtocolDetailComponent.coverageLabel; expose failed,
   *    blocked and untested counts without dropping any of the 39 roster IDs.
   * 4. Extend directory/detail/availability specs for historical complete plus
   *    NOT TESTED, stale authority plus accepted reads, revision/network mismatch,
   *    and a fully evidenced denominator. Run npm test -- in frontend with those
   *    three spec paths, then AOT and desktop/mobile theme checks for UI changes.
   * Acceptance requires real supported Signet/Testnet readback evidence, separate
   * from these unit checks. No production config/migration is changed here.
   * Roll back frontend and backend contract versions together if incompatible.
   */
  coverageLabel(protocol: ExplorerProtocolDefinition): string {
    const coverage = protocol.coverage;
    if (coverage === null || coverage === undefined || coverage === '') {
      return $localize`:@@universe.protocols.coverage-unknown:Coverage unknown`;
    }
    if (typeof coverage === 'string') {
      return $localize`:@@universe.protocols.coverage:Coverage: ${this.humanize(coverage)}:coverage:`;
    }
    const state = (coverage as ProtocolCoverage).state;
    if (state) {
      return $localize`:@@universe.protocols.coverage:Coverage: ${this.humanize(state)}:coverage:`;
    }
    return $localize`:@@universe.protocols.coverage-unknown:Coverage unknown`;
  }

  coverageKnown(protocol: ExplorerProtocolDefinition): boolean {
    const coverage = protocol.coverage;
    if (coverage === null || coverage === undefined || coverage === '') {
      return false;
    }
    return typeof coverage === 'string' || !!(coverage as ProtocolCoverage).state;
  }

  sourceFor(
    protocol: ExplorerProtocolDefinition,
    sources: Map<string, SourceEntry> | null,
  ): SourceEntry | null {
    return sourceForProtocol(protocol, sources);
  }

  /**
   * The evidence behind the primary label: where the authority has reached,
   * how far behind that is, and when it was last checked. Without this a
   * reader has to take the label on trust.
   */
  sourceDetail(source: SourceEntry | null): string | null {
    if (!source) return null;
    const parts: string[] = [];
    if (source.checkpoint) {
      parts.push($localize`:@@universe.protocols.detail-height:Indexed to block ${source.checkpoint.heightAtomic}:height:`);
    }
    const lag = source.lagBlocks;
    if (lag && lag !== '0') {
      parts.push($localize`:@@universe.protocols.detail-lag:${lag}:lag: blocks behind the chain tip`);
    }
    if (source.consecutiveFailures) {
      parts.push($localize`:@@universe.protocols.detail-failures:${source.consecutiveFailures}:failures: checks failed in a row`);
    }
    return parts.length ? parts.join(' \u00b7 ') : null;
  }

  /** When this authority was last asked, as epoch seconds, or null. */
  checkedAtSeconds(source: SourceEntry | null): number | null {
    if (!source?.checkedAt) return null;
    const at = Date.parse(source.checkedAt);
    return Number.isFinite(at) ? Math.floor(at / 1000) : null;
  }

  /** Re-reads the registry and the authority snapshot, cancelling any attempt in flight. */
  onRetry(): void {
    this.retry$.next(this.retry$.value + 1);
  }

  trackByProtocol(index: number, protocol: ExplorerProtocolDefinition): string {
    return protocol.id;
  }

  trackByGroup(index: number, group: FamilyGroup): string {
    return group.label;
  }
}
