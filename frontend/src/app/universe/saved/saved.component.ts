import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, combineLatest, map } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { ExplorerChain } from '@app/universe/universe.types';
import { explorerChainName } from '@app/universe/universe-chain-routing';
import {
  UniverseEntry,
  UniverseEntryKind,
  UniverseLocalService,
} from '@app/universe/universe-local.service';

interface SavedViewModel {
  readonly bookmarks: readonly UniverseEntry[];
  readonly recent: readonly UniverseEntry[];
  readonly pinnedProtocols: readonly string[];
}

/**
 * Everything this browser remembers, in one place, with one button that
 * forgets all of it. Nothing here was ever sent to a server, so this page is
 * also the complete answer to "what does the explorer know about me".
 */
@Component({
  selector: 'app-universe-saved',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './saved.component.html',
  styleUrls: ['./saved.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavedComponent implements OnInit {
  vm$: Observable<SavedViewModel>;
  confirmingReset = false;
  chainFilter: ExplorerChain | 'all' = 'all';
  kindFilter: UniverseEntryKind | 'all' = 'all';
  readonly chainFilters: readonly (ExplorerChain | 'all')[] = [
    'all',
    'bitcoin',
    'dogecoin',
    'zcash',
  ];
  readonly kindFilters: readonly (UniverseEntryKind | 'all')[] = [
    'all',
    'address',
    'protocol',
    'transaction',
    'block',
    'outpoint',
    'inscription',
    'rune',
    'sat',
  ];

  constructor(
    private local: UniverseLocalService,
    private seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.seo.setTitle('Saved in this browser');
    this.vm$ = combineLatest([
      this.local.bookmarks$,
      this.local.recent$,
      this.local.preferences$,
    ]).pipe(
      map(([bookmarks, recent, preferences]): SavedViewModel => ({
        bookmarks,
        recent,
        pinnedProtocols: preferences.pinnedProtocols,
      })),
    );
  }

  remove(entry: UniverseEntry): void {
    this.local.removeBookmark(
      entry.kind as UniverseEntryKind,
      entry.value,
      entry.chain,
      entry.network,
    );
  }

  clearRecent(): void {
    this.local.clearRecent();
  }

  visibleEntries(entries: readonly UniverseEntry[]): readonly UniverseEntry[] {
    return entries.filter(
      (entry) =>
        (this.chainFilter === 'all' || entry.chain === this.chainFilter) &&
        (this.kindFilter === 'all' || entry.kind === this.kindFilter),
    );
  }

  updateChainFilter(value: string): void {
    if (this.chainFilters.includes(value as ExplorerChain | 'all')) {
      this.chainFilter = value as ExplorerChain | 'all';
    }
  }

  updateKindFilter(value: string): void {
    if (this.kindFilters.includes(value as UniverseEntryKind | 'all')) {
      this.kindFilter = value as UniverseEntryKind | 'all';
    }
  }

  unpin(protocolId: string): void {
    this.local.togglePinnedProtocol(protocolId);
  }

  askReset(): void {
    this.confirmingReset = true;
  }

  cancelReset(): void {
    this.confirmingReset = false;
  }

  confirmReset(): void {
    this.local.resetAll();
    this.confirmingReset = false;
  }

  /** A chain as a reader should see it, or the word for every chain. */
  chainFilterLabel(chain: ExplorerChain | 'all'): string {
    return chain === 'all'
      ? $localize`:@@universe.saved.filter-all-chains:Every chain`
      : explorerChainName(chain);
  }

  kindFilterLabel(kind: UniverseEntryKind | 'all'): string {
    return kind === 'all'
      ? $localize`:@@universe.saved.filter-all-kinds:Every kind`
      : this.kindLabel(kind);
  }

  /** Where an entry lives, written out: "Dogecoin, mainnet". */
  originLabel(entry: UniverseEntry): string {
    return `${explorerChainName(entry.chain)}, ${entry.network}`;
  }

  /**
   * A protocol id as a reader should see it. The registry's display names live
   * behind a request this page deliberately does not make, so the id is
   * presented readably rather than raw: nothing is invented, only cased.
   */
  protocolLabel(protocolId: string): string {
    const words = protocolId.replace(/[_-]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  kindLabel(kind: string): string {
    switch (kind) {
      case 'transaction': return $localize`:@@universe.saved.kind-transaction:Transaction`;
      case 'block': return $localize`:@@universe.saved.kind-block:Block`;
      case 'address': return $localize`:@@universe.saved.kind-address:Address`;
      case 'outpoint': return $localize`:@@universe.saved.kind-outpoint:Output`;
      case 'inscription': return $localize`:@@universe.saved.kind-inscription:Inscription`;
      case 'rune': return $localize`:@@universe.saved.kind-rune:Rune`;
      case 'sat': return $localize`:@@universe.saved.kind-sat:Sat`;
      case 'protocol': return $localize`:@@universe.saved.kind-protocol:Protocol`;
      default: return kind;
    }
  }

  trackByEntry(index: number, entry: UniverseEntry): string {
    return `${entry.chain}:${entry.network}:${entry.kind}:${entry.value}`;
  }
}
