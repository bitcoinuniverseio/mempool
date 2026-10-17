/**
 * Wire-shaped universe-asset-inventory-v1 payloads for the inventory specs.
 * Values are JSON as the producer sends them, so the decoder is exercised on
 * the same shapes it meets in production.
 */
import { ORDINAL_INVENTORY_PROTOCOLS } from './asset-inventory.types';

export const TXID = 'a'.repeat(64);
export const BLOCK_HASH = 'b'.repeat(64);
export const OTHER_HASH = 'c'.repeat(64);
export const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
export const INSCRIPTION_ID = 'd'.repeat(64) + 'i0';

export type Wire = Record<string, any>;

export function key(protocolId: string, nativeId: string, namespace = ''): string {
  return ['bitcoin', 'mainnet', protocolId, namespace, nativeId].map(encodeURIComponent).join(':');
}

export function coverage(protocolId: string, state = 'complete', reasons: string[] = []): Wire {
  return {
    protocolId,
    sourceId: protocolId === 'ordinals' || protocolId === 'rare_sats' ? 'ord' : 'index-' + protocolId,
    state,
    reasons,
    checkpoint: { sourceId: 'ord', heightAtomic: '900000', blockHash: BLOCK_HASH, generation: null },
    ruleset: null,
  };
}

export function allCoverage(overrides: Record<string, [string, string[]?]> = {}): Wire[] {
  return ORDINAL_INVENTORY_PROTOCOLS.map((protocolId) => {
    const override = overrides[protocolId];
    return coverage(protocolId, override?.[0] ?? 'complete', override?.[1] ?? []);
  });
}

export function inscriptionAsset(id = INSCRIPTION_ID, classifications: Wire[] = []): Wire {
  return {
    key: key('ordinals', id),
    protocolId: 'ordinals',
    subprotocolId: null,
    namespace: null,
    nativeId: id,
    kind: 'inscription',
    ticker: null,
    displayName: null,
    decimals: 0,
    unit: 'inscription',
    inscription: { numberAtomic: '74120884', contentType: 'text/plain', satAtomic: '1968750000000000', parents: [], charms: [] },
    sat: null,
    classifications,
  };
}

export function fungibleAsset(protocolId: string, nativeId: string, decimals: number | null, unit: string, subprotocolId: string | null = null): Wire {
  return {
    key: key(protocolId, nativeId),
    protocolId,
    subprotocolId,
    namespace: null,
    nativeId,
    kind: 'fungible',
    ticker: nativeId,
    displayName: null,
    decimals,
    unit,
    inscription: null,
    sat: null,
    classifications: [],
  };
}

export function satAsset(sat: string, rarity: string, height: string): Wire {
  return {
    key: key('rare_sats', sat),
    protocolId: 'rare_sats',
    subprotocolId: rarity,
    namespace: null,
    nativeId: sat,
    kind: 'sat',
    ticker: null,
    displayName: null,
    decimals: 0,
    unit: 'sat',
    inscription: null,
    sat: { satAtomic: sat, rarity, heightAtomic: height },
    classifications: [],
  };
}

export function inventory(kind: 'transaction' | 'block' | 'address', input: Wire = {}): Wire {
  const { scope: scopeOverrides, ...overrides } = input;
  const scopeKey = kind === 'transaction' ? TXID : kind === 'block' ? BLOCK_HASH : ADDRESS;
  const coverageRows = overrides.coverage ?? allCoverage();
  const page = overrides.page !== undefined
    ? overrides.page
    : kind === 'transaction' ? null : { cursor: null, nextCursor: null, fromIndex: 0, toIndex: 1, totalItems: 1 };
  return {
    schemaVersion: 'universe-asset-inventory-v1',
    scope: {
      kind,
      chain: 'bitcoin',
      network: 'mainnet',
      key: scopeKey,
      heightAtomic: '900000',
      blockHash: kind === 'block' ? BLOCK_HASH : kind === 'address' ? BLOCK_HASH : null,
      confirmed: kind === 'address' ? null : true,
      ...(scopeOverrides ?? {}),
    },
    assets: [],
    groups: [],
    placements: [],
    events: [],
    balances: [],
    checkpoints: [{ sourceId: 'ord', heightAtomic: '900000', blockHash: BLOCK_HASH, generation: null }],
    generatedAt: '2026-10-17T00:00:00.000Z',
    ...overrides,
    coverage: coverageRows,
    page,
    complete: overrides.complete ?? (coverageRows.every((row: Wire) => row.state === 'complete')
      && (page === null || page.nextCursor === null)),
  };
}

/** One cursor page of a block or address walk. */
export function pageOf(kind: 'block' | 'address', index: number, pages: number, perPage: number, body: Wire = {}): Wire {
  const last = index === pages - 1;
  const coverageRows = body.coverage ?? (last ? allCoverage() : allCoverage({ ordinals: ['partial', ['more-pages']] }));
  return inventory(kind, {
    ...body,
    coverage: coverageRows,
    page: {
      cursor: index === 0 ? null : 'cursor-' + index,
      nextCursor: last ? null : 'cursor-' + (index + 1),
      fromIndex: index * perPage,
      toIndex: (index + 1) * perPage,
      totalItems: pages * perPage,
    },
  });
}
