import { Component, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ExplorerProtocolDefinition, ProtocolCoverage, ProtocolsResponse } from '@app/universe/universe.types';
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
    this.vm$ = this.universeApiService.getProtocols$().pipe(
      map((response: ProtocolsResponse): DirectoryViewModel => {
        const bitcoinProtocols = (response.protocols || []).filter(p => p.chain === 'bitcoin');
        const otherChainCount = (response.protocols || []).length - bitcoinProtocols.length;
        return {
          loading: false,
          error: false,
          registryVersion: response.registryVersion,
          groups: this.groupByFamily(bitcoinProtocols),
          otherChainCount,
        };
      }),
      catchError(() => of({ loading: false, error: true })),
    );
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

  releaseStatusLabel(protocol: ExplorerProtocolDefinition): string {
    const status = (protocol.releaseStatus || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
    switch (status) {
      case 'blocked': return 'Blocked';
      case 'read only': return 'Read only';
      case 'production': return 'Production';
      case '': return 'Status unknown';
      default: return this.humanize(status);
    }
  }

  releaseStatusClass(protocol: ExplorerProtocolDefinition): string {
    const status = (protocol.releaseStatus || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
    switch (status) {
      case 'blocked': return 'chip-blocked';
      case 'read only': return 'chip-read-only';
      case 'production': return 'chip-production';
      default: return 'chip-neutral';
    }
  }

  coverageLabel(protocol: ExplorerProtocolDefinition): string {
    const coverage = protocol.coverage;
    if (coverage === null || coverage === undefined || coverage === '') {
      return 'Coverage unknown';
    }
    if (typeof coverage === 'string') {
      return 'Coverage: ' + this.humanize(coverage);
    }
    const state = (coverage as ProtocolCoverage).state;
    if (state) {
      return 'Coverage: ' + this.humanize(state);
    }
    return 'Coverage unknown';
  }

  coverageKnown(protocol: ExplorerProtocolDefinition): boolean {
    return this.coverageLabel(protocol) !== 'Coverage unknown';
  }

  trackByProtocol(index: number, protocol: ExplorerProtocolDefinition): string {
    return protocol.id;
  }

  trackByGroup(index: number, group: FamilyGroup): string {
    return group.label;
  }
}
