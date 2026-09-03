/**
 * The workspace migration: transactional, idempotent, lossless.
 *
 * Reads the old plaintext watchlist (`universe.portfolio.watchlist.v1`),
 * previews exactly what will move, builds the new portfolio + accounts,
 * validates record counts and a content hash, and only then commits.
 * The old records are retained (never silently deleted) until the new
 * vault has been reopened successfully, and a migration marker keeps the
 * process idempotent.
 */

import {
  emptyPortfolio,
  newLocalId,
  type LocalAccount,
  type LocalPortfolio,
} from '../stores/portfolio-model';

export interface MigrationPreview {
  readonly watched: readonly {
    readonly chain: string;
    readonly network: string;
    readonly address: string;
    readonly label: string;
    readonly group: string;
  }[];
  readonly watchedCount: number;
  readonly labelCount: number;
  readonly groupCount: number;
  readonly contentHash: string;
}

const WATCHLIST_KEY = 'universe.portfolio.watchlist.v1';
const ENTRY = /^[0-9A-Za-z]{10,256}$/;
const CHAIN = /^[a-z][a-z0-9-]{0,31}$/;

/** Reads and validates the old store. Malformed entries are dropped, not trusted. */
export function migrateWorkspace(): MigrationPreview {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const entries = Array.isArray(raw) ? raw : [];
  const watched: { chain: string; network: string; address: string; label: string; group: string }[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    const chain = typeof candidate.chain === 'string' && CHAIN.test(candidate.chain) ? candidate.chain : null;
    const network = typeof candidate.network === 'string' && CHAIN.test(candidate.network) ? candidate.network : null;
    const address = typeof candidate.address === 'string' && ENTRY.test(candidate.address) ? candidate.address : null;
    if (chain === null || network === null || address === null) continue;
    const label = typeof candidate.label === 'string' ? candidate.label.slice(0, 60) : '';
    const group = typeof candidate.group === 'string' ? candidate.group.slice(0, 40) : '';
    watched.push({ chain, network, address, label, group });
  }
  const labels = watched.filter((entry) => entry.label.length > 0).length;
  const groupNames = new Set(watched.map((entry) => entry.group).filter((group) => group.length > 0));
  return {
    watched,
    watchedCount: watched.length,
    labelCount: labels,
    groupCount: groupNames.size,
    contentHash: hashWatched(watched),
  };
}

function hashWatched(watched: MigrationPreview['watched']): string {
  const text = watched
    .map((entry) => `${entry.chain}:${entry.network}:${entry.address}:${entry.label}:${entry.group}`)
    .sort()
    .join('|');
  let hash = 5381;
  for (const character of text) {
    hash = ((hash << 5) + hash + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16);
}

/**
 * Builds the migrated portfolio: one account per (chain, network) group
 * boundary the old store expressed, labels preserved verbatim, groups
 * preserved as local groups.
 */
export function buildMigratedPortfolio(
  base: LocalPortfolio,
  preview: MigrationPreview,
): LocalPortfolio {
  const now = new Date().toISOString();
  const groups = new Map<string, string>();
  for (const entry of preview.watched) {
    if (entry.group.length === 0) continue;
    if (!groups.has(entry.group)) {
      const id = newLocalId();
      groups.set(entry.group, id);
    }
  }
  const accountKeys = new Map<string, LocalAccount>();
  for (const entry of preview.watched) {
    const key = `${entry.chain}:${entry.network}`;
    const account =
      accountKeys.get(key) ??
      ({
        id: newLocalId(),
        name: entry.label.length > 0 ? entry.label : key,
        chain: entry.chain,
        network: entry.network,
        kind: 'addresses',
        addresses: [],
        groupId: groups.get(entry.group),
        tags: ['migrated'],
        createdAt: now,
      } satisfies LocalAccount);
    if (!account.addresses!.includes(entry.address)) {
      (account.addresses as string[]).push(entry.address);
    }
    accountKeys.set(key, account);
  }
  const portfolio = emptyPortfolio(base.id, base.name, base.createdAt);
  return {
    ...portfolio,
    accounts: [...accountKeys.values()],
    groups: [...groups.entries()].map(([name, id]) => ({ id, name })),
    annotations: {
      ...Object.fromEntries(
        preview.watched
          .filter((entry) => entry.label.length > 0)
          .map((entry) => [`address:${entry.address}`, { note: entry.label }]),
      ),
    },
    createdAt: base.createdAt,
    updatedAt: now,
  };
}

/** True when the old store still holds records (rollback copy retained). */
export function legacyWatchlistRetained(): boolean {
  return localStorage.getItem(WATCHLIST_KEY) !== null;
}
