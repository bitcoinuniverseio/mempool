import { Component, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { Observable, catchError, combineLatest, map, of } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  ExplorerProtocolDefinition,
  ProtocolCoverage,
  ProtocolsResponse,
  SourceEntry,
  SourcesResponse,
} from '@app/universe/universe.types';
import { SeoService } from '@app/services/seo.service';

interface FamilyGroup {
  family: string;
  label: string;
  protocols: ExplorerProtocolDefinition[];
}

interface DirectoryViewModel {
  loading: boolean;
  error: boolean;
  registryVersion?: string;
  groups?: FamilyGroup[];
  otherChainCount?: number;
  liveCount?: number;
  totalCount?: number;
  /** null when the source snapshot could not be read; the page still renders. */
  sourcesByAuthority?: Map<string, SourceEntry> | null;
}

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

  constructor(
    private universeApiService: UniverseApiService,
    private seoService: SeoService,
  ) { }

  ngOnInit(): void {
    this.seoService.setTitle('Universe Protocols');
    // The registry is the page; the live source snapshot only annotates it, so
    // a failing snapshot must not blank out the directory.
    const sources$ = this.universeApiService.getSources$().pipe(
      catchError(() => of(null)),
    );
    this.vm$ = combineLatest([this.universeApiService.getProtocols$(), sources$]).pipe(
      map(([response, sources]: [ProtocolsResponse, SourcesResponse | null]): DirectoryViewModel => {
        const bitcoinProtocols = (response.protocols || []).filter(p => p.chain === 'bitcoin');
        const otherChainCount = (response.protocols || []).length - bitcoinProtocols.length;
        return {
          loading: false,
          error: false,
          registryVersion: response.registryVersion,
          groups: this.groupByFamily(bitcoinProtocols),
          otherChainCount,
          liveCount: bitcoinProtocols.filter(p => this.isLive(p)).length,
          totalCount: bitcoinProtocols.length,
          sourcesByAuthority: this.indexSources(sources),
        };
      }),
      catchError(() => of({ loading: false, error: true })),
    );
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
    return (protocol.releaseStatus || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  }

  /** True when this protocol is readable in the explorer today. */
  isLive(protocol: ExplorerProtocolDefinition): boolean {
    const status = this.normalizeStatus(protocol);
    return status === 'verified read only' || status === 'production verified';
  }

  releaseStatusLabel(protocol: ExplorerProtocolDefinition): string {
    switch (this.normalizeStatus(protocol)) {
      case 'production verified': return $localize`:@@universe.protocols.status-production:Live`;
      case 'verified read only': return $localize`:@@universe.protocols.status-read-only:Live, read only`;
      case 'blocked': return $localize`:@@universe.protocols.status-blocked:Not yet available`;
      case 'intentionally disabled': return $localize`:@@universe.protocols.status-disabled:Disabled`;
      case '': return $localize`:@@universe.protocols.status-unknown:Status unknown`;
      default: return this.humanize(this.normalizeStatus(protocol));
    }
  }

  releaseStatusClass(protocol: ExplorerProtocolDefinition): string {
    switch (this.normalizeStatus(protocol)) {
      case 'production verified': return 'chip-production';
      case 'verified read only': return 'chip-live';
      case 'blocked': return 'chip-blocked';
      case 'intentionally disabled': return 'chip-disabled';
      default: return 'chip-unknown';
    }
  }

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
    if (!sources || !protocol.indexerAuthority) {
      return null;
    }
    return sources.get(protocol.indexerAuthority) ?? null;
  }

  /** Live authority state, phrased as what the snapshot actually proves. */
  sourceLabel(source: SourceEntry): string {
    if (source.ready && source.checkpoint) {
      return $localize`:@@universe.protocols.source-ready:Authority ready at block ${source.checkpoint.heightAtomic}:height:`;
    }
    switch (source.status) {
      case 'ready': return $localize`:@@universe.protocols.source-ready-nocheckpoint:Authority ready`;
      case 'stale': return $localize`:@@universe.protocols.source-stale:Authority behind the chain tip`;
      case 'unreachable': return $localize`:@@universe.protocols.source-unreachable:Authority unreachable`;
      case 'unconfigured': return $localize`:@@universe.protocols.source-unconfigured:Authority not configured here`;
      default: return $localize`:@@universe.protocols.source-degraded:Authority degraded`;
    }
  }

  sourceClass(source: SourceEntry): string {
    if (source.ready) {
      return 'chip-live';
    }
    return source.status === 'unconfigured' ? 'chip-unknown' : 'chip-blocked';
  }

  trackByProtocol(index: number, protocol: ExplorerProtocolDefinition): string {
    return protocol.id;
  }

  trackByGroup(index: number, group: FamilyGroup): string {
    return group.label;
  }
}
