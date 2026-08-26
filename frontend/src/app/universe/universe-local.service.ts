import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

/**
 * Local personalization for the explorer.
 *
 * Everything here lives in the visitor's own browser. No identifier, search
 * term, or bookmark is ever sent anywhere, so returning visitors get a more
 * useful product without the explorer building a profile of them. Storage can
 * be unavailable (private windows, blocked site data, server-side rendering),
 * so every read and write is guarded and the product works with none of it.
 */

const RECENT_KEY = 'universe.recent.v1';
const BOOKMARK_KEY = 'universe.bookmarks.v1';
const PREFERENCE_KEY = 'universe.preferences.v1';

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
  /** Stable identity: kind plus value. */
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
}

const DEFAULT_PREFERENCES: UniversePreferences = {
  pinnedProtocols: [],
  animatePulse: true,
};

function entryKey(kind: string, value: string): string {
  return `${kind}:${value}`;
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
      this.recentSubject.next(this.readEntries(RECENT_KEY, MAXIMUM_RECENT));
      this.bookmarkSubject.next(this.readEntries(BOOKMARK_KEY, MAXIMUM_BOOKMARKS));
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
    if (
      typeof kind !== 'string' || !kind ||
      typeof value !== 'string' || !value || value.length > 200 ||
      typeof path !== 'string' || !path.startsWith('/') || path.length > 400 ||
      typeof label !== 'string' || !label ||
      typeof at !== 'number' || !Number.isFinite(at)
    ) {
      return null;
    }
    return {
      kind: kind as UniverseEntryKind,
      value,
      path,
      label: label.slice(0, MAXIMUM_LABEL_LENGTH),
      at,
    };
  }

  private readEntries(key: string, limit: number): readonly UniverseEntry[] {
    const parsed = this.read(key);
    if (!Array.isArray(parsed)) {return [];}
    const entries: UniverseEntry[] = [];
    const seen = new Set<string>();
    for (const candidate of parsed) {
      const entry = this.sanitizeEntry(candidate);
      if (!entry) {continue;}
      const id = entryKey(entry.kind, entry.value);
      if (seen.has(id)) {continue;}
      seen.add(id);
      entries.push(entry);
      if (entries.length >= limit) {break;}
    }
    return entries;
  }

  private readPreferences(): UniversePreferences {
    const parsed = this.read(PREFERENCE_KEY);
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
    };
  }

  /** Current recently viewed entries, without subscribing. */
  recentSnapshot(): readonly UniverseEntry[] {
    return this.recentSubject.value;
  }

  /** Records a visit. Most recent first, duplicates collapse to one entry. */
  recordVisit(entry: Omit<UniverseEntry, 'at'>): void {
    if (!this.available()) {return;}
    const sanitized = this.sanitizeEntry({ ...entry, at: Date.now() });
    if (!sanitized) {return;}
    const id = entryKey(sanitized.kind, sanitized.value);
    const next = [
      sanitized,
      ...this.recentSubject.value.filter((item) => entryKey(item.kind, item.value) !== id),
    ].slice(0, MAXIMUM_RECENT);
    this.recentSubject.next(next);
    this.write(RECENT_KEY, next);
  }

  clearRecent(): void {
    this.recentSubject.next([]);
    if (this.available()) {this.write(RECENT_KEY, []);}
  }

  isBookmarked(kind: UniverseEntryKind, value: string): boolean {
    const id = entryKey(kind, value);
    return this.bookmarkSubject.value.some((item) => entryKey(item.kind, item.value) === id);
  }

  /** Adds or removes a bookmark. Returns the state after the change. */
  toggleBookmark(entry: Omit<UniverseEntry, 'at'>): boolean {
    if (!this.available()) {return false;}
    const sanitized = this.sanitizeEntry({ ...entry, at: Date.now() });
    if (!sanitized) {return false;}
    const id = entryKey(sanitized.kind, sanitized.value);
    const existing = this.bookmarkSubject.value;
    const without = existing.filter((item) => entryKey(item.kind, item.value) !== id);
    const added = without.length === existing.length;
    const next = added ? [sanitized, ...without].slice(0, MAXIMUM_BOOKMARKS) : without;
    this.bookmarkSubject.next(next);
    this.write(BOOKMARK_KEY, next);
    return added;
  }

  removeBookmark(kind: UniverseEntryKind, value: string): void {
    const id = entryKey(kind, value);
    const next = this.bookmarkSubject.value.filter(
      (item) => entryKey(item.kind, item.value) !== id,
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
    } catch {
      // Nothing to clean up if the store cannot be reached.
    }
  }
}
