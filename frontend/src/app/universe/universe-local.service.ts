import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { ExplorerChain, ExplorerNetwork } from '@app/universe/universe.types';

/**
 * Local personalization for the explorer.
 *
 * Everything here lives in the visitor's own browser. No identifier, search
 * term, or bookmark is ever sent anywhere, so returning visitors get a more
 * useful product without the explorer building a profile of them. Storage can
 * be unavailable (private windows, blocked site data, server-side rendering),
 * so every read and write is guarded and the product works with none of it.
 */

const RECENT_KEY = 'universe.recent.v2';
const BOOKMARK_KEY = 'universe.bookmarks.v2';
const PREFERENCE_KEY = 'universe.preferences.v2';
const LEGACY_RECENT_KEY = 'universe.recent.v1';
const LEGACY_BOOKMARK_KEY = 'universe.bookmarks.v1';
const LEGACY_PREFERENCE_KEY = 'universe.preferences.v1';

const MAXIMUM_RECENT = 8;
const MAXIMUM_BOOKMARKS = 250;
const MAXIMUM_LABEL_LENGTH = 120;

export type UniverseEntryKind =
  | 'transaction'
  | 'block'
  | 'address'
  | 'outpoint'
  | 'inscription'
  | 'rune'
  | 'sat'
  | 'protocol';

export interface UniverseEntry {
  /** Stable identity includes chain and network so equal hashes never collide. */
  readonly chain: ExplorerChain;
  readonly network: ExplorerNetwork;
  readonly kind: UniverseEntryKind;
  readonly value: string;
  /** Router path this entry opens. */
  readonly path: string;
  /** What the visitor sees. Never longer than a line. */
  readonly label: string;
  /** Milliseconds since the epoch, recorded when the entry was last touched. */
  readonly at: number;
}

export interface UniversePreferences {
  /** Protocol ids the visitor pinned to the top of protocol filters. */
  readonly pinnedProtocols: readonly string[];
  /** Whether the live pulse animates. Independent of the OS reduced-motion setting, which always wins. */
  readonly animatePulse: boolean;
  /** Convenience only. The URL remains authoritative for shared links. */
  readonly selectedChain: ExplorerChain;
}

const DEFAULT_PREFERENCES: UniversePreferences = {
  pinnedProtocols: [],
  animatePulse: true,
  selectedChain: 'bitcoin',
};

type UniverseEntryInput = Omit<UniverseEntry, 'at' | 'chain' | 'network'> &
  Partial<Pick<UniverseEntry, 'chain' | 'network'>>;

const ENTRY_KINDS = new Set<UniverseEntryKind>([
  'transaction', 'block', 'address', 'outpoint', 'inscription', 'rune', 'sat', 'protocol',
]);
const CHAINS = new Set<ExplorerChain>(['bitcoin', 'dogecoin', 'zcash']);
const NETWORKS = new Set<ExplorerNetwork>(['mainnet', 'testnet', 'regtest']);

function entryKey(entry: Pick<UniverseEntry, 'chain' | 'network' | 'kind' | 'value'>): string {
  return `${entry.chain}:${entry.network}:${entry.kind}:${entry.value}`;
}

@Injectable({ providedIn: 'root' })
export class UniverseLocalService {
  private readonly recentSubject = new BehaviorSubject<readonly UniverseEntry[]>([]);
  private readonly bookmarkSubject = new BehaviorSubject<readonly UniverseEntry[]>([]);
  private readonly preferenceSubject =
    new BehaviorSubject<UniversePreferences>(DEFAULT_PREFERENCES);

  readonly recent$: Observable<readonly UniverseEntry[]> = this.recentSubject.asObservable();
  readonly bookmarks$: Observable<readonly UniverseEntry[]> = this.bookmarkSubject.asObservable();
  readonly preferences$: Observable<UniversePreferences> = this.preferenceSubject.asObservable();

  constructor(private stateService: StateService) {
    if (this.available()) {
      this.recentSubject.next(this.readEntries(RECENT_KEY, LEGACY_RECENT_KEY, MAXIMUM_RECENT));
      this.bookmarkSubject.next(this.readEntries(BOOKMARK_KEY, LEGACY_BOOKMARK_KEY, MAXIMUM_BOOKMARKS));
      this.preferenceSubject.next(this.readPreferences());
    }
  }

  private available(): boolean {
    return !!this.stateService?.isBrowser;
  }

  private read(key: string): unknown {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // A full or blocked store is not an error the visitor needs to see; the
      // page keeps working, it just will not remember this.
    }
  }

  private sanitizeEntry(candidate: unknown): UniverseEntry | null {
    if (typeof candidate !== 'object' || candidate === null) {return null;}
    const entry = candidate as Record<string, unknown>;
    const kind = entry.kind;
    const value = entry.value;
    const path = entry.path;
    const label = entry.label;
    const at = entry.at;
    const chain = entry.chain ?? 'bitcoin';
    const network = entry.network ?? 'mainnet';
    if (
      typeof kind !== 'string' || !ENTRY_KINDS.has(kind as UniverseEntryKind) ||
      typeof chain !== 'string' || !CHAINS.has(chain as ExplorerChain) ||
      typeof network !== 'string' || !NETWORKS.has(network as ExplorerNetwork) ||
      typeof value !== 'string' || !value || value.length > 200 ||
      typeof path !== 'string' || !path.startsWith('/') || path.length > 400 ||
      typeof label !== 'string' || !label ||
      typeof at !== 'number' || !Number.isFinite(at)
    ) {
      return null;
    }
    return {
      chain: chain as ExplorerChain,
      network: network as ExplorerNetwork,
      kind: kind as UniverseEntryKind,
      value,
      path,
      label: label.slice(0, MAXIMUM_LABEL_LENGTH),
      at,
    };
  }

  private readEntries(key: string, legacyKey: string, limit: number): readonly UniverseEntry[] {
    const current = this.read(key);
    const migrated = !Array.isArray(current);
    const parsed = migrated ? this.read(legacyKey) : current;
    if (!Array.isArray(parsed)) {return [];}
    const entries: UniverseEntry[] = [];
    const seen = new Set<string>();
    for (const candidate of parsed) {
      const entry = this.sanitizeEntry(candidate);
      if (!entry) {continue;}
      const id = entryKey(entry);
      if (seen.has(id)) {continue;}
      seen.add(id);
      entries.push(entry);
      if (entries.length >= limit) {break;}
    }
    if (migrated && entries.length) {this.write(key, entries);}
    return entries;
  }

  private readPreferences(): UniversePreferences {
    const current = this.read(PREFERENCE_KEY);
    const parsed = typeof current === 'object' && current !== null
      ? current
      : this.read(LEGACY_PREFERENCE_KEY);
    if (typeof parsed !== 'object' || parsed === null) {return DEFAULT_PREFERENCES;}
    const record = parsed as Record<string, unknown>;
    const pinned = Array.isArray(record.pinnedProtocols)
      ? record.pinnedProtocols
          .filter((id): id is string => typeof id === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(id))
          .slice(0, 24)
      : [];
    return {
      pinnedProtocols: pinned,
      animatePulse: record.animatePulse !== false,
      selectedChain: typeof record.selectedChain === 'string' && CHAINS.has(record.selectedChain as ExplorerChain)
        ? record.selectedChain as ExplorerChain
        : 'bitcoin',
    };
  }

  /** Current recently viewed entries, without subscribing. */
  recentSnapshot(): readonly UniverseEntry[] {
    return this.recentSubject.value;
  }

  /** Records a visit. Most recent first, duplicates collapse to one entry. */
  recordVisit(entry: UniverseEntryInput): void {
    if (!this.available()) {return;}
    const sanitized = this.sanitizeEntry({ ...entry, at: Date.now() });
    if (!sanitized) {return;}
    const id = entryKey(sanitized);
    const next = [
      sanitized,
      ...this.recentSubject.value.filter((item) => entryKey(item) !== id),
    ].slice(0, MAXIMUM_RECENT);
    this.recentSubject.next(next);
    this.write(RECENT_KEY, next);
  }

  clearRecent(): void {
    this.recentSubject.next([]);
    if (this.available()) {this.write(RECENT_KEY, []);}
  }

  isBookmarked(
    kind: UniverseEntryKind,
    value: string,
    chain: ExplorerChain = 'bitcoin',
    network: ExplorerNetwork = 'mainnet',
  ): boolean {
    const id = entryKey({ chain, network, kind, value });
    return this.bookmarkSubject.value.some((item) => entryKey(item) === id);
  }

  /** Adds or removes a bookmark. Returns the state after the change. */
  toggleBookmark(entry: UniverseEntryInput): boolean {
    if (!this.available()) {return false;}
    const sanitized = this.sanitizeEntry({ ...entry, at: Date.now() });
    if (!sanitized) {return false;}
    const id = entryKey(sanitized);
    const existing = this.bookmarkSubject.value;
    const without = existing.filter((item) => entryKey(item) !== id);
    const added = without.length === existing.length;
    const next = added ? [sanitized, ...without].slice(0, MAXIMUM_BOOKMARKS) : without;
    this.bookmarkSubject.next(next);
    this.write(BOOKMARK_KEY, next);
    return added;
  }

  removeBookmark(
    kind: UniverseEntryKind,
    value: string,
    chain: ExplorerChain = 'bitcoin',
    network: ExplorerNetwork = 'mainnet',
  ): void {
    const id = entryKey({ chain, network, kind, value });
    const next = this.bookmarkSubject.value.filter(
      (item) => entryKey(item) !== id,
    );
    this.bookmarkSubject.next(next);
    if (this.available()) {this.write(BOOKMARK_KEY, next);}
  }

  setPreferences(patch: Partial<UniversePreferences>): void {
    const next: UniversePreferences = {
      ...this.preferenceSubject.value,
      ...patch,
      pinnedProtocols: (patch.pinnedProtocols ?? this.preferenceSubject.value.pinnedProtocols)
        .slice(0, 24),
    };
    this.preferenceSubject.next(next);
    if (this.available()) {this.write(PREFERENCE_KEY, next);}
  }

  togglePinnedProtocol(protocolId: string): void {
    const pinned = this.preferenceSubject.value.pinnedProtocols;
    const next = pinned.includes(protocolId)
      ? pinned.filter((id) => id !== protocolId)
      : [...pinned, protocolId];
    this.setPreferences({ pinnedProtocols: next });
  }

  selectedChainSnapshot(): ExplorerChain {
    return this.preferenceSubject.value.selectedChain;
  }

  setSelectedChain(selectedChain: ExplorerChain): void {
    if (!CHAINS.has(selectedChain)) {return;}
    this.setPreferences({ selectedChain });
  }

  /** Forgets everything this browser has stored for the explorer. */
  resetAll(): void {
    this.recentSubject.next([]);
    this.bookmarkSubject.next([]);
    this.preferenceSubject.next(DEFAULT_PREFERENCES);
    if (!this.available()) {return;}
    try {
      localStorage.removeItem(RECENT_KEY);
      localStorage.removeItem(BOOKMARK_KEY);
      localStorage.removeItem(PREFERENCE_KEY);
      localStorage.removeItem(LEGACY_RECENT_KEY);
      localStorage.removeItem(LEGACY_BOOKMARK_KEY);
      localStorage.removeItem(LEGACY_PREFERENCE_KEY);
    } catch {
      // Nothing to clean up if the store cannot be reached.
    }
  }
}
