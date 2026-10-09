import { explorerReadOperations } from './explorer-read-operations';
/**
 * Universe Explorer protocol registry.
 *
 * Generates the versioned, framework-neutral explorer protocol manifest from
 * the ecosystem contracts registry (`@bitcoinuniverse/ecosystem-contracts`)
 * plus explorer-curated metadata (families, navigation order, authorities).
 *
 * Rules enforced here:
 * - `runes` is the ONLY public Rune identity. The legacy `runes_native`
 *   adapter id is folded into the `runes` alias set and never emitted as a
 *   registry entry.
 * - Protocols appear only on their actual chain (chain-domain isolation).
 * - Release status is truthful: an entry is marked readable only when a
 *   first-party Universe authority for it has been verified; everything else
 *   stays BLOCKED until its integration is completed and verified.
 */

import {
  EXPLORER_PROTOCOL_SCHEMA_VERSION,
  ExplorerCoverage,
  ExplorerProtocolDefinition,
  ExplorerReleaseStatus,
} from '../contracts/explorer-evidence';

import { PROTOCOL_CAPABILITIES } from '@bitcoinuniverse/ecosystem-contracts';

export const EXPLORER_REGISTRY_VERSION = '1.1.0';

/**
 * Schema identity of the manifest envelope this repository publishes.
 *
 * The roster is consumed by another repository, and a consumer that reads a
 * document it cannot name has no way to say what changed. Every published
 * manifest carries this version, the registry version, the repository that
 * produced it and the commit that repository was built from, so a mismatch is
 * a statement about two identified things rather than a diff of two anonymous
 * files.
 */
export const EXPLORER_MANIFEST_SCHEMA_VERSION =
  'universe-explorer-protocol-manifest-v1';

/** The repository that owns the roster. Consumers pin against this name. */
export const EXPLORER_MANIFEST_SOURCE_REPOSITORY =
  'bitcoinuniverseio/backend-apis';

/** Navigation families (Phase 9.2). */
export type ExplorerProtocolFamily =
  | 'ORDINALS'
  | 'RUNES'
  | 'ALKANES'
  | 'STAMPS'
  | 'ATOMICALS'
  | 'OP DATA'
  | 'OTHER';

/** Primary public protocol strip order; MORE opens the full directory. */
export const EXPLORER_PRIMARY_STRIP = [
  'ORDINALS',
  'RUNES',
  'ALKANES',
  'STAMPS',
  'ATOMICALS',
  'MORE',
] as const;

interface CuratedEntry {
  family: ExplorerProtocolFamily;
  shortName: string;
  chain?: string;
  /** Extra aliases beyond the ecosystem contract aliases. */
  aliases?: string[];
  /** Display name override when the id has no ecosystem contract entry. */
  displayName?: string;
  indexerAuthority?: string;
  releaseStatus: ExplorerReleaseStatus;
  coverage: ExplorerCoverage;
  sort: number;
}

/**
 * Explorer-curated protocol table. `releaseStatus` starts BLOCKED for every
 * protocol and is upgraded to VERIFIED READ ONLY / PRODUCTION VERIFIED only
 * when that protocol's explorer integration is completed and verified against
 * its Universe authority. No protocol may silently disappear from this table.
 */
/**
 * IMPLEMENTATION-HANDOFF B01 (2026-09-18):
 * Historical coverage is curated metadata, not current full-history proof or
 * operation acceptance. Only seven entries below claim complete coverage. For
 * EACH manifest id, bind authority, chain/network, source SHA,
 * activation/start height, contiguous scanned range and checkpoint/hash to
 * reproducible tip evidence. Reconcile deployed manifest SHA separately from
 * this checkout before changing releaseStatus or coverage. Preserve all chain
 * boundaries.
 */

const CURATED: Record<string, CuratedEntry> = {
  // ORDINALS family
  ordinals: {
    family: 'ORDINALS',
    shortName: 'Ordinals',
    indexerAuthority: 'ord',
    releaseStatus: 'VERIFIED READ ONLY',
    coverage: 'complete',
    sort: 10,
  },
  rare_sats: {
    family: 'ORDINALS',
    shortName: 'Rare Sats',
    indexerAuthority: 'ord',
    releaseStatus: 'VERIFIED READ ONLY',
    coverage: 'complete',
    sort: 11,
  },
  names: {
    family: 'ORDINALS',
    shortName: 'Names',
    indexerAuthority: 'index-names',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 12,
  },
  bitmap: {
    family: 'ORDINALS',
    shortName: 'Bitmap',
    indexerAuthority: 'index-bitmap',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 13,
  },
  unat: {
    family: 'ORDINALS',
    shortName: 'UNAT',
    indexerAuthority: 'index-unat',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 14,
  },

  // RUNES family (single public identity; runes_native folded into aliases)
  runes: {
    family: 'RUNES',
    shortName: 'RUNES',
    aliases: ['runes_native', 'native-runes'],
    indexerAuthority: 'ord',
    releaseStatus: 'VERIFIED READ ONLY',
    coverage: 'complete',
    sort: 20,
  },

  // ALKANES family
  alkanes: {
    family: 'ALKANES',
    shortName: 'Alkanes',
    indexerAuthority: 'index-alkanes',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 30,
  },
  mezcal: {
    family: 'ALKANES',
    shortName: 'Mezcal',
    indexerAuthority: 'index-mezcal',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 31,
  },

  // STAMPS family
  stamps: {
    family: 'STAMPS',
    shortName: 'Stamps',
    indexerAuthority: 'index-stamps',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 40,
  },
  src20: {
    family: 'STAMPS',
    shortName: 'SRC-20',
    indexerAuthority: 'index-stamps',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 41,
  },
  src101: {
    family: 'STAMPS',
    shortName: 'SRC-101',
    indexerAuthority: 'index-stamps',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 42,
  },

  // ATOMICALS family
  atomicals_nft: {
    family: 'ATOMICALS',
    shortName: 'Atomicals NFTs',
    indexerAuthority: 'index-atomicals-nfts-and-realms',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 50,
  },
  realms: {
    family: 'ATOMICALS',
    shortName: 'Realms',
    indexerAuthority: 'index-atomicals-nfts-and-realms',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 51,
  },
  subrealms: {
    family: 'ATOMICALS',
    shortName: 'Subrealms',
    indexerAuthority: 'index-atomicals-nfts-and-realms',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 52,
  },
  arc20: {
    family: 'ATOMICALS',
    shortName: 'ARC-20',
    indexerAuthority: 'index-atomicals',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 53,
  },

  // OP DATA family
  op_return: {
    family: 'OP DATA',
    shortName: 'OP_RETURN',
    indexerAuthority: 'index-op20',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 60,
  },
  /**
   * IMPLEMENTATION-HANDOFF [WP-OV-002] | OV-F002 | 2026-10-03
   * Status: FAIL; preparation only, executable behavior unchanged.
   * Dependencies: WP-OV-001, WP-OV-005.
   * Evidence: overlay-reproduction-results.json;
   * overlay-authority-sources/index-op20/docs/OP_NAMES_AUTHORITY.md;
   * overlay-authority-sources/index-op20/src/op-names/authority.mjs. Sources: OV-S-OP20-NAMES;
   * OV-S-OP20-FEED.
   * 1. Keep the published op_names identity, but after the independent read producer is
   * verified, bind its indexerAuthority to index-op20-op-names rather than the OP20 feed source.
   * 2. Update PROTOCOL_FEED_ROUTES, source descriptors and the deployment manifest together;
   * retain all 39 ids and do not mark this readable/accepted from source registration alone. 3.
   * Regenerate the producer/consumer manifests, then test alias uniqueness, source-route binding
   * and OP_RETURN regression with registry/read-operation specs and npm run
   * verify:contract:protocols. Source requirement: index-op20@82bd266...
   * docs/OP_NAMES_AUTHORITY.md; the new route is PROPOSED NEW until the owning event-reader
   * package passes.
   * Acceptance: OP Names public activity contains only the dedicated authority's chain-validated
   * OP Names events, with exact identity/custody/validity, pagination and reorg semantics;
   * OP_RETURN regression is unchanged; no non-assets stub is used as empty proof.
   * Rollback: Deploy compatible producer before consumer; keep independent secrets and existing
   * scanner singleton. Roll back routing and consumer together to an explicit unavailable OP
   * Names capability, not to mislabeled OP20 data. Do not drop/rebuild authority tables or
   * change genesis/approval attestations merely for this read adapter.
   */
  op_names: {
    family: 'OP DATA',
    shortName: 'OP_NAMES',
    indexerAuthority: 'index-op20-op-names',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 61,
  },
  op_inscriptions: {
    family: 'OP DATA',
    shortName: 'OP_INSCRIPTIONS',
    indexerAuthority: 'index-opinscriptions',
    // Verified 2026-08-30 against the supervised first-party authority: its
    // canonical checkpoint stayed at zero lag while following new mainnet
    // blocks, and Explorer consumes the same proof-bearing health route.
    releaseStatus: 'VERIFIED READ ONLY',
    coverage: 'complete',
    sort: 62,
  },
  op_drop: {
    family: 'OP DATA',
    shortName: 'OP_DROP',
    indexerAuthority: 'index-drops-and-opdrop',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 63,
  },
  drops: {
    family: 'OP DATA',
    shortName: 'Drops',
    indexerAuthority: 'index-drops-and-opdrop',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 64,
  },

  // OTHER (bitcoin)
  brc20: {
    family: 'OTHER',
    shortName: 'BRC-20',
    indexerAuthority: 'index-brc20',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 70,
  },
  tap: {
    family: 'OTHER',
    shortName: 'TAP',
    indexerAuthority: 'index-tap',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 71,
  },
  dmt: {
    family: 'OTHER',
    shortName: 'DMT',
    indexerAuthority: 'index-dmt',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 72,
  },
  dust20: {
    family: 'OTHER',
    shortName: 'DUST-20',
    indexerAuthority: 'index-dust20',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 73,
  },
  block20: {
    family: 'OTHER',
    shortName: 'Block-20',
    indexerAuthority: 'index-block20',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 74,
  },
  chainbloom: {
    family: 'OTHER',
    shortName: 'ChainBloom',
    indexerAuthority: 'index-chainbloom',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 75,
  },
  patina: {
    family: 'OTHER',
    shortName: 'Patina',
    displayName: 'Patina',
    indexerAuthority: 'index-patina',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 76,
  },
  witness_circles: {
    family: 'OTHER',
    shortName: 'Witness Circles',
    displayName: 'Witness Circles',
    aliases: ['witness-circles'],
    indexerAuthority: 'index-witness-circles',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 77,
  },
  tandem: {
    family: 'OTHER',
    shortName: 'Tandem',
    displayName: 'Tandem',
    indexerAuthority: 'index-tandem',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 78,
  },
  cat20: {
    family: 'OTHER',
    shortName: 'CAT-20',
    chain: 'fractal',
    indexerAuthority: 'index-cat20',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 79,
  },
  ordex: {
    family: 'OTHER',
    shortName: 'Ordex',
    indexerAuthority: 'index-ordinals',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 80,
  },
  anima: {
    family: 'OTHER',
    shortName: 'ANIMA',
    displayName: 'ANIMA',
    indexerAuthority: 'index-anima',
    // BLOCKED until the index-anima authority is configured in a deployment,
    // its health route answers, and the ANIMA evidence explorer reads live
    // data through it. The reader ships beside this entry; the status waits
    // for the live verification it claims.
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 81,
  },

  // Dogecoin chain (never shown on Bitcoin views)
  doginals: {
    family: 'OTHER',
    shortName: 'Doginals',
    chain: 'dogecoin',
    indexerAuthority: 'ord-dogecoin',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 90,
  },
  drc20: {
    family: 'OTHER',
    shortName: 'DRC-20',
    chain: 'dogecoin',
    indexerAuthority: 'ord-dogecoin',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 91,
  },
  tap_doge: {
    family: 'OTHER',
    shortName: 'Doge TAP',
    chain: 'dogecoin',
    indexerAuthority: 'index-doge-tap',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 92,
  },
  dunes: {
    family: 'OTHER',
    shortName: 'Dunes',
    displayName: 'Dunes',
    chain: 'dogecoin',
    indexerAuthority: 'ord-dogecoin',
    releaseStatus: 'BLOCKED',
    coverage: 'unknown',
    sort: 93,
  },

  // Zcash chain (never shown on Bitcoin views). Verified 2026-08-29 against
  // the deployed index-zcash-metaprotocols authority through the production
  // overlay: chain scan complete at tip, live mempool candidates, list and
  // detail reads answering for every family. ZRunes correctly reports no
  // etchings before its mainnet activation height of 3470000, and ZRC-20 is
  // served under both documented rulesets rather than silently choosing one.
  zerdinals: {
    family: 'OTHER',
    shortName: 'Zerdinals',
    chain: 'zcash',
    indexerAuthority: 'index-zcash-metaprotocols',
    releaseStatus: 'VERIFIED READ ONLY',
    coverage: 'complete',
    sort: 95,
  },
  zrunes: {
    family: 'OTHER',
    shortName: 'zRunes',
    chain: 'zcash',
    indexerAuthority: 'index-zcash-metaprotocols',
    releaseStatus: 'VERIFIED READ ONLY',
    coverage: 'complete',
    sort: 96,
  },
  zrc20: {
    family: 'OTHER',
    shortName: 'ZRC-20',
    chain: 'zcash',
    indexerAuthority: 'index-zcash-metaprotocols',
    releaseStatus: 'VERIFIED READ ONLY',
    coverage: 'complete',
    sort: 97,
  },
};

/** Ids that must never appear as public registry entries. */
const NON_PUBLIC_IDS = new Set(['bitcoin', 'runes_native', 'avm', 'cat721']);

const DEFAULT_NETWORKS = ['mainnet'];
/**
 * IMPLEMENTATION-HANDOFF [WP-OV-005] | OV-B005 | 2026-10-03
 * Status: BLOCKED; preparation only, executable behavior unchanged.
 * Dependencies: none.
 * Evidence: overlay-source-manifest.json;
 * overlay-authority-sources/ord-dogecoin/src/authority_api.rs;
 * overlay-authority-sources/index-zcash-metaprotocols/src/config.mjs. Sources: OV-S-DOGE-ORD;
 * OV-S-ZCASH-INDEXER; OV-S-OVERLAY; root research authority source register.
 * 1. Replace chain-wide support assumptions with a reviewed per-protocol supported-context
 * table derived from the exact owning sources/specifications. Current default emits mainnet
 * for every non-Fractal protocol even where an authority supports Signet; source claims and
 * activation readiness are separate. 2. Keep all 39 identities; resolve Witness
 * Circles/UNAT/Tandem/CAT20 current-source drift and each activation prerequisite before
 * publishing support. 3. Keep acceptance environment (Signet or justified Testnet) distinct
 * from release environment; do not relabel test checkpoints or fabricate Mainnet activation.
 * 4. Extend registry/manifest tests for multi-network descriptors and context-qualified
 * acceptance; regenerate manifests only from the reviewed producer. Actual runtime and full
 * per-operation coverage remain blocked until the accepted authority matrix is complete.
 * Acceptance: Every required authority/read operation has a versioned governing contract,
 * supported isolated test context, current deployment identity and full authoritative/consumer
 * evidence. Historical readability or source startup readiness never substitutes for operation
 * acceptance.
 * Rollback: Preserve singleton indexers, good catch-up/replay and existing state. Back up only
 * when a real migration is required; use source-owned reorg/recovery. No guessed activation
 * height or approval removal.
 */
const NETWORKS_BY_CHAIN: Readonly<Record<string, string[]>> = {
  fractal: ['mainnet', 'testnet'],
};

function buildDefinition(
  id: string,
  curated: CuratedEntry,
): ExplorerProtocolDefinition {
  const contract = (
    PROTOCOL_CAPABILITIES as Record<
      string,
      | { displayName: string; aliases: readonly string[]; chain: string }
      | undefined
    >
  )[id];
  const aliasSet = new Set<string>([
    ...(contract?.aliases ?? []),
    ...(curated.aliases ?? []),
  ]);
  aliasSet.delete(id);
  const chain = curated.chain ?? contract?.chain ?? 'bitcoin';
  const networks = NETWORKS_BY_CHAIN[chain] ?? DEFAULT_NETWORKS;
  const operations = explorerReadOperations(id, {
    chain,
    network: networks[0] ?? 'mainnet',
  });
  return {
    schemaVersion: EXPLORER_PROTOCOL_SCHEMA_VERSION,
    id,
    aliases: [...aliasSet],
    displayName:
      curated.displayName ?? contract?.displayName ?? curated.shortName,
    shortName: curated.shortName,
    family: curated.family,
    chain,
    networks,
    icon: `protocol-${id.replace(/_/g, '-')}`,
    visualToken: `protocol-${id.replace(/_/g, '-')}`,
    implementedReadOperations: operations.map((operation) => operation.id),
    readOperationDescriptors: operations,
    authorizedReadOperations: operations.map((operation) => operation.id),
    releaseStatus: curated.releaseStatus,
    indexerAuthority: curated.indexerAuthority,
    coverage: curated.coverage,
  };
}

/**
 * Refuses a roster that cannot be resolved unambiguously.
 *
 * Two entries sharing an id, or one entry claiming an alias that is another
 * entry's id or alias, make {@link resolveExplorerProtocol} answer by table
 * order rather than by meaning. That is the shape a protocol duplicated under
 * incompatible ids takes, and it is cheaper to refuse to serve it than to
 * explain later which of the two answers a page was showing.
 */
export function assertRosterResolvesUniquely(
  definitions: readonly ExplorerProtocolDefinition[],
): void {
  const owner = new Map<string, string>();
  const seenIds = new Set<string>();
  for (const definition of definitions) {
    if (seenIds.has(definition.id)) {
      throw new Error(
        `Protocol registry is ambiguous: "${definition.id}" is claimed by both of two entries.`,
      );
    }
    seenIds.add(definition.id);
    const claims = [definition.id, ...definition.aliases];
    for (const claim of claims) {
      const key = claim.trim().toLowerCase();
      if (!key) {
        throw new Error(
          `Protocol ${definition.id} claims an empty id or alias.`,
        );
      }
      const existing = owner.get(key);
      if (existing && existing !== definition.id) {
        throw new Error(
          `Protocol registry is ambiguous: "${key}" is claimed by both ${existing} and ${definition.id}.`,
        );
      }
      if (existing === definition.id && key !== definition.id) {
        throw new Error(
          `Protocol ${definition.id} repeats the alias "${key}".`,
        );
      }
      owner.set(key, definition.id);
    }
  }
  for (const nonPublic of NON_PUBLIC_IDS) {
    if (definitions.some((definition) => definition.id === nonPublic)) {
      throw new Error(
        `Protocol registry emitted ${nonPublic}, which is not a public identity.`,
      );
    }
  }
}

let cache: ExplorerProtocolDefinition[] | null = null;

/** The full ordered explorer protocol manifest (all chains). */
export function explorerProtocolManifest(): ExplorerProtocolDefinition[] {
  if (!cache) {
    const built = Object.entries(CURATED)
      .filter(([id]) => !NON_PUBLIC_IDS.has(id))
      .sort((a, b) => a[1].sort - b[1].sort)
      .map(([id, curated]) => buildDefinition(id, curated));
    assertRosterResolvesUniquely(built);
    cache = built;
  }
  return cache;
}

/** Manifest restricted to a single chain domain. */
export function explorerProtocolManifestForChain(
  chain: string,
): ExplorerProtocolDefinition[] {
  return explorerProtocolManifest().filter((p) => p.chain === chain);
}

/** Resolves a public id or alias to its registry entry, if any. */
export function resolveExplorerProtocol(
  idOrAlias: string,
): ExplorerProtocolDefinition | null {
  const needle = idOrAlias.trim().toLowerCase();
  if (!needle) return null;
  for (const def of explorerProtocolManifest()) {
    if (def.id === needle) return def;
    if (def.aliases.some((a) => a.toLowerCase() === needle)) return def;
  }
  return null;
}
