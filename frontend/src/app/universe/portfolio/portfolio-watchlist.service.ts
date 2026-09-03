import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

/**
 * The visitor's own watchlist, labels, and groups.
 *
 * Everything here lives in this browser's local storage and is never sent
 * anywhere: no account, no server record, no profile. A watched address is
 * a private note to yourself, so a shared portfolio URL carries no trace
 * of what else you watch or what you called it.
 *
 * The store is validated on read as strictly as any authority response.
 * Local storage is writable by anything on the origin, so a malformed or
 * hostile entry is dropped rather than trusted into the interface.
 */

export interface WatchedAddress {
  readonly chain: string;
  readonly network: string;
  readonly address: string;
  /** The visitor's own name for it. Never derived from chain data. */
  readonly label: string;
  /** Group name, or the empty string for ungrouped. */
  readonly group: string;
  /** Milliseconds since the epoch when this entry was last touched. */
  readonly at: number;
}

const WATCHLIST_KEY = 'universe.portfolio.watchlist.v1';
const MAXIMUM_WATCHED = 200;
export const MAXIMUM_LABEL_LENGTH = 60;
export const MAXIMUM_GROUP_LENGTH = 40;

const CHAIN = /^[a-z][a-z0-9-]{0,31}$/;
const NETWORK = /^[a-z][a-z0-9-]{0,31}$/;
const ADDRESS = /^[0-9A-Za-z]{10,256}$/;

/** The identity of one watched address: chain, network, and the address. */
export function watchKey(
  entry: Pick<WatchedAddress, 'chain' | 'network' | 'address'>,
): string {
  return `${entry.chain}:${entry.network}:${entry.address}`;
}

/**
 * Strips characters that would let a label impersonate interface text or
 * smuggle control characters into a page. What remains is the visitor's
 * words, trimmed to a line.
 */
export function sanitizeLabel(value: unknown, maximum: number): string {
  if (typeof value !== 'string') { return ''; }
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, maximum);
}

@Injectable({ providedIn: 'root' })
export class PortfolioWatchlistService {
  private readonly subject = new BehaviorSubject<readonly WatchedAddress[]>([]);
  readonly watched$: Observable<readonly WatchedAddress[]> = this.subject.asObservable();

  constructor(private stateService: StateService) {
    if (this.available()) {
      this.subject.next(this.read());
    }
  }

  private available(): boolean {
    return !!this.stateService?.isBrowser;
  }

  private read(): readonly WatchedAddress[] {
    let parsed: unknown;
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) { return []; }
    const entries: WatchedAddress[] = [];
    const seen = new Set<string>();
    for (const candidate of parsed) {
      const entry = sanitizeWatched(candidate);
      if (!entry) { continue; }
      const id = watchKey(entry);
      if (seen.has(id)) { continue; }
      seen.add(id);
      entries.push(entry);
      if (entries.length >= MAXIMUM_WATCHED) { break; }
    }
    return entries;
  }

  private write(entries: readonly WatchedAddress[]): void {
    this.subject.next(entries);
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(entries));
    } catch {
      // A full or blocked store keeps the page working; it just will not
      // remember this across visits.
    }
  }

  snapshot(): readonly WatchedAddress[] {
    return this.subject.value;
  }

  isWatched(chain: string, network: string, address: string): boolean {
    const id = watchKey({ chain, network, address });
    return this.subject.value.some((entry) => watchKey(entry) === id);
  }

  watchedEntry(
    chain: string,
    network: string,
    address: string,
  ): WatchedAddress | null {
    const id = watchKey({ chain, network, address });
    return this.subject.value.find((entry) => watchKey(entry) === id) ?? null;
  }

  /** Adds or updates a watched address. Returns false when refused. */
  watch(input: {
    chain: string;
    network: string;
    address: string;
    label?: string;
    group?: string;
  }): boolean {
    if (!this.available()) { return false; }
    const entry = sanitizeWatched({
      ...input,
      label: input.label ?? '',
      group: input.group ?? '',
      at: Date.now(),
    });
    if (!entry) { return false; }
    const id = watchKey(entry);
    const without = this.subject.value.filter((item) => watchKey(item) !== id);
    this.write([entry, ...without].slice(0, MAXIMUM_WATCHED));
    return true;
  }

  unwatch(chain: string, network: string, address: string): void {
    if (!this.available()) { return; }
    const id = watchKey({ chain, network, address });
    this.write(this.subject.value.filter((entry) => watchKey(entry) !== id));
  }

  /** Toggles watching. Returns the state after the change. */
  toggle(input: {
    chain: string;
    network: string;
    address: string;
    label?: string;
  }): boolean {
    if (this.isWatched(input.chain, input.network, input.address)) {
      this.unwatch(input.chain, input.network, input.address);
      return false;
    }
    return this.watch(input);
  }

  /** Renames a watched address, or clears the label with an empty string. */
  relabel(
    chain: string,
    network: string,
    address: string,
    label: string,
  ): void {
    const existing = this.watchedEntry(chain, network, address);
    if (!existing) { return; }
    this.watch({ ...existing, label });
  }

  /** Moves a watched address into a group, or out of one with ''. */
  regroup(
    chain: string,
    network: string,
    address: string,
    group: string,
  ): void {
    const existing = this.watchedEntry(chain, network, address);
    if (!existing) { return; }
    this.watch({ ...existing, group });
  }

  /** Every group name currently in use, sorted, ungrouped excluded. */
  groups(): readonly string[] {
    return [
      ...new Set(
        this.subject.value
          .map((entry) => entry.group)
          .filter((group) => group.length > 0),
      ),
    ].sort();
  }

  clearAll(): void {
    if (!this.available()) { return; }
    this.write([]);
  }
}

/** Validates one stored entry. Returns null for anything unusable. */
export function sanitizeWatched(candidate: unknown): WatchedAddress | null {
  if (typeof candidate !== 'object' || candidate === null) { return null; }
  const entry = candidate as Record<string, unknown>;
  const chain = entry.chain;
  const network = entry.network;
  const address = entry.address;
  const at = entry.at;
  if (
    typeof chain !== 'string' || !CHAIN.test(chain)
    || typeof network !== 'string' || !NETWORK.test(network)
    || typeof address !== 'string' || !ADDRESS.test(address)
    || typeof at !== 'number' || !Number.isFinite(at) || at < 0
  ) {
    return null;
  }
  return {
    chain,
    network,
    address,
    label: sanitizeLabel(entry.label, MAXIMUM_LABEL_LENGTH),
    group: sanitizeLabel(entry.group, MAXIMUM_GROUP_LENGTH),
    at,
  };
}
