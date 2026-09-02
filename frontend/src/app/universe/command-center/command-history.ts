/**
 * What the command center remembers, on this device only.
 *
 * Recent queries and saved queries are personal data. They live in local
 * storage under keys this explorer owns, they never leave the browser, and
 * every function takes the storage as an argument so a blocked or absent
 * store degrades to an empty list rather than an error.
 */

export interface StoredQuery {
  readonly query: string;
  /** Milliseconds since the epoch, recorded when the query was used. */
  readonly at: number;
}

export const RECENT_KEY = 'universe.command.recent.v1';
export const SAVED_KEY = 'universe.command.saved.v1';
export const MAXIMUM_RECENT = 10;
export const MAXIMUM_SAVED = 30;

function read(storage: Storage | null, key: string): StoredQuery[] {
  if (!storage) { return []; }
  try {
    const raw = storage.getItem(key);
    if (!raw) { return []; }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) { return []; }
    return parsed
      .filter((entry) => entry && typeof entry.query === 'string' && typeof entry.at === 'number')
      .map((entry) => ({ query: entry.query, at: entry.at }));
  } catch {
    // A value this explorer cannot validate is a value it ignores.
    return [];
  }
}

function write(storage: Storage | null, key: string, entries: readonly StoredQuery[]): void {
  if (!storage) { return; }
  try {
    storage.setItem(key, JSON.stringify(entries.slice(0, 40)));
  } catch {
    // Full or blocked storage: the memory is a convenience, not a record.
  }
}

export function loadRecent(storage: Storage | null): StoredQuery[] {
  return read(storage, RECENT_KEY).slice(0, MAXIMUM_RECENT);
}

/** Records a query, newest first, collapsing repeats of the same query. */
export function pushRecent(storage: Storage | null, query: string, at: number = Date.now()): StoredQuery[] {
  const trimmed = (query ?? '').trim();
  if (!trimmed) { return loadRecent(storage); }
  const rest = read(storage, RECENT_KEY).filter((entry) => entry.query !== trimmed);
  const next = [{ query: trimmed, at }, ...rest].slice(0, MAXIMUM_RECENT);
  write(storage, RECENT_KEY, next);
  return next;
}

export function loadSaved(storage: Storage | null): StoredQuery[] {
  return read(storage, SAVED_KEY).slice(0, MAXIMUM_SAVED);
}

/** True when the query was not already saved. */
export function saveQuery(storage: Storage | null, query: string, at: number = Date.now()): boolean {
  const trimmed = (query ?? '').trim();
  if (!trimmed) { return false; }
  const existing = read(storage, SAVED_KEY);
  if (existing.some((entry) => entry.query === trimmed)) { return false; }
  write(storage, SAVED_KEY, [{ query: trimmed, at }, ...existing].slice(0, MAXIMUM_SAVED));
  return true;
}

export function removeSaved(storage: Storage | null, query: string): StoredQuery[] {
  const next = read(storage, SAVED_KEY).filter((entry) => entry.query !== query);
  write(storage, SAVED_KEY, next);
  return next;
}
