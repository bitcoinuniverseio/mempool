/**
 * The transaction asset summary contract (summary-v1), mirrored from the
 * backend, plus the runtime decoder that validates it.
 *
 * A TypeScript generic on an HttpClient call is a compile-time claim about an
 * untrusted payload, not a check. Everything the summary displays is a number
 * a user may act on, so the payload is decoded here: quantities must be
 * unsigned integer strings, divisibility must be in range, logo URLs must be
 * same-origin content-addressed paths, and the stated counts must agree with
 * the rows actually present.
 *
 * Unknown fields survive. A source that adds a field must not break a client,
 * but malformed required data is an error rather than something to render.
 */

import { exactDecimal } from '@app/universe/asset-summary/asset-summary.presentation';

export const EXPLORER_TX_ASSET_SUMMARY_SCHEMA_VERSION =
  'universe-transaction-asset-summary-v1';

/**
 * The coverage states, as a value rather than only as a type.
 *
 * A type annotation on an untrusted payload is a claim, not a check. The
 * decoder validates against this set, because an unrecognised state cast to the
 * union renders as whichever branch the template falls through to, and the
 * fall-through branch is usually the reassuring one.
 */
export const SUMMARY_COVERAGE_STATES = [
  'complete',
  'partial',
  'proven-empty',
  'candidate-only',
  'unsupported-network',
  'unconfigured',
  'unavailable',
  'not-publicly-observable',
] as const;

export type SummaryCoverageState = (typeof SUMMARY_COVERAGE_STATES)[number];

/** Coverage states under which the inventory is not conclusive. */
export const INCONCLUSIVE_COVERAGE: ReadonlySet<SummaryCoverageState> =
  new Set<SummaryCoverageState>([
    'partial',
    'candidate-only',
    'unsupported-network',
    'unconfigured',
    'unavailable',
    'not-publicly-observable',
  ]);

export interface SummaryProtocolCoverage {
  protocolId: string;
  chain: string;
  network: string;
  state: SummaryCoverageState;
  reason?: string;
}

export interface SummaryQuantitySide {
  quantityAtomic: string | null;
  positionCountAtomic: string;
  complete: boolean;
}

/**
 * What one authority states it observed, and when.
 *
 * Preserved rather than dropped because it is the difference between "this
 * authority rejected the transfer" and "no authority has ruled on it yet". A
 * view that has only `accepted: false` cannot tell a reader which it is.
 */
export interface SummaryEvidence {
  authorityId: string;
  protocolId: string | null;
  coverage: string;
  checkedAt: string | null;
  checkpoint: SummaryCheckpoint | null;
}

export interface SummaryEffect {
  eventId: string;
  actionType: string;
  quantityAtomic: string | null;
  accepted: boolean;
  /** The authority's own record for this effect, or null when it sent none. */
  evidence: SummaryEvidence | null;
}

/**
 * The block a reading was taken at.
 *
 * Every field is required because a partial checkpoint is not a checkpoint: a
 * height of zero beside a real block hash is a statement that the reading was
 * taken at genesis. Absent is represented by a null checkpoint, never by a
 * checkpoint full of zeroes.
 */
export interface SummaryCheckpoint {
  chain: string;
  network: string;
  heightAtomic: string;
  blockHash: string;
  reorgEpoch: string;
  observedAt: string | null;
}

export interface SummaryLogo {
  objectPath: string;
  contentHash: string;
  mediaType: string;
  widthAtomic?: string;
  heightAtomic?: string;
  metadataRevision: string;
  verified: true;
}

export interface SummaryAsset {
  chain: string;
  network: string;
  protocolId: string;
  assetId: string;
  ruleset: string | null;
  assetKind: string;
  displayName: string | null;
  ticker: string | null;
  decimals: number | null;
  logo: SummaryLogo | null;
  inputs: SummaryQuantitySide;
  outputs: SummaryQuantitySide;
  effects: SummaryEffect[];
  /** Every authority that contributed a position for this identity. */
  evidence: SummaryEvidence[];
}

export interface SummaryCounts {
  fungibleTypeCountAtomic: string;
  collectibleItemCountAtomic: string;
  otherAssetCountAtomic: string;
  protocolCountAtomic: string;
  knownCountAtomic: string;
  totalCount: number | null;
}

export interface TransactionAssetSummary {
  schemaVersion: string;
  chain: string;
  network: string;
  txid: string;
  status: string;
  assets: SummaryAsset[];
  perProtocolCoverage: SummaryProtocolCoverage[];
  counts: SummaryCounts;
  retryAfterSeconds: number | null;
  /** The reading's checkpoint, or null when no authority stated a complete one. */
  checkpoint: SummaryCheckpoint | null;
}

const ATOMIC_INTEGER = /^(0|[1-9][0-9]*)$/;
const TXID = /^[0-9a-f]{64}$/;
const CONTENT_HASH = /^[0-9a-f]{64}$/;
const MAX_DECIMALS = 38;

export class SummaryDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SummaryDecodeError';
  }
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SummaryDecodeError(what + ' is not an object');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) {
    throw new SummaryDecodeError(what + ' is not a non-empty string');
  }
  return value;
}

function nullableText(value: unknown, what: string): string | null {
  if (value === null || value === undefined) {return null;}
  return text(value, what);
}

/** An unsigned atomic integer string, or null. Never a number, never signed. */
function atomic(value: unknown, what: string): string | null {
  if (value === null || value === undefined) {return null;}
  if (typeof value !== 'string' || !ATOMIC_INTEGER.test(value)) {
    throw new SummaryDecodeError(what + ' is not an atomic integer string');
  }
  return value;
}

function atomicRequired(value: unknown, what: string): string {
  const parsed = atomic(value, what);
  if (parsed === null) {
    throw new SummaryDecodeError(what + ' is required');
  }
  return parsed;
}

function decimals(value: unknown): number | null {
  if (value === null || value === undefined) {return null;}
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < 0 || value > MAX_DECIMALS) {
    throw new SummaryDecodeError('decimals out of range');
  }
  return value;
}

function side(value: unknown, what: string): SummaryQuantitySide {
  const row = record(value, what);
  return {
    quantityAtomic: atomic(row.quantityAtomic, what + '.quantityAtomic'),
    positionCountAtomic: atomicRequired(row.positionCountAtomic, what + '.positionCountAtomic'),
    complete: row.complete === true,
  };
}

/**
 * A curated logo, or null.
 *
 * The path must be the same-origin content-addressed object path for the hash
 * the payload states. An absolute URL, a traversal or a mismatched hash is a
 * null logo rather than an error: missing artwork must never remove a proven
 * asset row or its quantity.
 */
function logo(value: unknown): SummaryLogo | null {
  if (value === null || value === undefined) {return null;}
  let row: Record<string, unknown>;
  try {
    row = record(value, 'logo');
  } catch {
    return null;
  }
  const contentHash = row.contentHash;
  const objectPath = row.objectPath;
  // The producer marks a curated logo verified. A row that does not say so
  // is not promoted to one here; it becomes the labelled fallback instead.
  if (row.verified !== true) {return null;}
  if (typeof contentHash !== 'string' || !CONTENT_HASH.test(contentHash)) {return null;}
  if (typeof objectPath !== 'string'
    || objectPath !== '/universe-media/v1/objects/' + contentHash) {
    return null;
  }
  return {
    objectPath,
    contentHash,
    mediaType: typeof row.mediaType === 'string' ? row.mediaType : 'image/*',
    ...(typeof row.widthAtomic === 'string' ? { widthAtomic: row.widthAtomic } : {}),
    ...(typeof row.heightAtomic === 'string' ? { heightAtomic: row.heightAtomic } : {}),
    metadataRevision: typeof row.metadataRevision === 'string' ? row.metadataRevision : '',
    verified: true,
  };
}

/**
 * A complete checkpoint, or null.
 *
 * Partial is null. Accepting a checkpoint with a missing height would let the
 * view print "block " followed by nothing, and accepting a zero height beside a
 * real block hash would state that the reading was taken at genesis.
 */
function checkpoint(value: unknown): SummaryCheckpoint | null {
  if (value === null || value === undefined) {return null;}
  let row: Record<string, unknown>;
  try {
    row = record(value, 'checkpoint');
  } catch {
    return null;
  }
  const heightAtomic = row.heightAtomic;
  const blockHash = row.blockHash;
  const reorgEpoch = row.reorgEpoch;
  if (typeof heightAtomic !== 'string' || !ATOMIC_INTEGER.test(heightAtomic)) {return null;}
  if (typeof blockHash !== 'string' || !CONTENT_HASH.test(blockHash)) {return null;}
  if (typeof reorgEpoch !== 'string' || !ATOMIC_INTEGER.test(reorgEpoch)) {return null;}
  if (typeof row.chain !== 'string' || !row.chain) {return null;}
  if (typeof row.network !== 'string' || !row.network) {return null;}
  return {
    chain: row.chain,
    network: row.network,
    heightAtomic,
    blockHash,
    reorgEpoch,
    observedAt: typeof row.observedAt === 'string' ? row.observedAt : null,
  };
}

/**
 * One authority's record, or null when the payload carries none.
 *
 * Malformed evidence becomes null rather than an error: evidence enriches the
 * explanation of a state the payload already states elsewhere, so losing it must
 * not discard a proven quantity.
 */
function evidence(value: unknown): SummaryEvidence | null {
  if (value === null || value === undefined) {return null;}
  let row: Record<string, unknown>;
  try {
    row = record(value, 'evidence');
  } catch {
    return null;
  }
  if (typeof row.authorityId !== 'string' || !row.authorityId) {return null;}
  return {
    authorityId: row.authorityId,
    protocolId: typeof row.protocolId === 'string' ? row.protocolId : null,
    coverage: typeof row.coverage === 'string' ? row.coverage : 'unknown',
    checkedAt: typeof row.checkedAt === 'string' ? row.checkedAt : null,
    checkpoint: checkpoint(row.checkpoint),
  };
}

function asset(value: unknown, index: number): SummaryAsset {
  const what = 'assets[' + index + ']';
  const row = record(value, what);
  // An absent effects list and an empty one mean the same thing, but a present
  // non-array is a malformed payload rather than an empty one.
  if (row.effects !== undefined && row.effects !== null && !Array.isArray(row.effects)) {
    throw new SummaryDecodeError(what + '.effects is not an array');
  }
  const effects = Array.isArray(row.effects) ? row.effects : [];
  if (row.evidence !== undefined && row.evidence !== null && !Array.isArray(row.evidence)) {
    throw new SummaryDecodeError(what + '.evidence is not an array');
  }
  const assetEvidence = Array.isArray(row.evidence) ? row.evidence : [];
  return {
    chain: text(row.chain, what + '.chain'),
    network: text(row.network, what + '.network'),
    protocolId: text(row.protocolId, what + '.protocolId'),
    assetId: text(row.assetId, what + '.assetId'),
    ruleset: nullableText(row.ruleset, what + '.ruleset'),
    assetKind: text(row.assetKind, what + '.assetKind'),
    displayName: nullableText(row.displayName, what + '.displayName'),
    ticker: nullableText(row.ticker, what + '.ticker'),
    decimals: decimals(row.decimals),
    logo: logo(row.logo),
    inputs: side(row.inputs, what + '.inputs'),
    outputs: side(row.outputs, what + '.outputs'),
    effects: effects.map((entry, position) => {
      const effect = record(entry, what + '.effects[' + position + ']');
      return {
        eventId: text(effect.eventId, what + '.effects.eventId'),
        actionType: text(effect.actionType, what + '.effects.actionType'),
        quantityAtomic: atomic(effect.quantityAtomic, what + '.effects.quantityAtomic'),
        // Only an explicit true is acceptance. Anything else covers both a
        // rejected record and one no authority has ruled on, which the view
        // must not narrow to "unconfirmed" without evidence that says so.
        accepted: effect.accepted === true,
        evidence: evidence(effect.evidence),
      };
    }),
    evidence: assetEvidence
      .map(evidence)
      .filter((entry): entry is SummaryEvidence => entry !== null),
  };
}

/** The identity key in its one agreed form. Never a ticker, a name or a txid. */
export function summaryAssetKey(entry: {
  chain: string; network: string; protocolId: string; assetId: string; ruleset: string | null;
}): string {
  return JSON.stringify([entry.chain, entry.network, entry.protocolId, entry.assetId, entry.ruleset]);
}

/**
 * Decodes and validates one summary payload for the context that was asked for.
 *
 * Rejecting a mismatched chain, network or txid here is what stops a late
 * response for a previous transaction, or for another network, from being
 * rendered as this page's asset inventory.
 */
export function decodeTransactionAssetSummary(
  value: unknown,
  expected: { chain: string; network: string; txid: string },
): TransactionAssetSummary {
  const row = record(value, 'summary');
  if (row.schemaVersion !== EXPLORER_TX_ASSET_SUMMARY_SCHEMA_VERSION) {
    throw new SummaryDecodeError('unsupported summary schema version');
  }
  const txid = text(row.txid, 'txid');
  if (!TXID.test(txid)) {throw new SummaryDecodeError('txid is malformed');}
  if (txid !== expected.txid || row.chain !== expected.chain || row.network !== expected.network) {
    throw new SummaryDecodeError('summary context mismatch');
  }
  // A missing assets array is not an empty inventory. Rendering one as "no
  // supported assets" is the single most misleading thing this component can
  // do, so the array is required and its absence is an error.
  if (!Array.isArray(row.assets)) {
    throw new SummaryDecodeError('summary.assets is not an array');
  }
  if (!Array.isArray(row.perProtocolCoverage)) {
    throw new SummaryDecodeError('summary.perProtocolCoverage is not an array');
  }
  const assets = row.assets.map(asset);
  const identities = new Set(assets.map(summaryAssetKey));
  if (identities.size !== assets.length) {
    throw new SummaryDecodeError('summary lists one asset identity twice');
  }
  for (const entry of assets) {
    if (entry.chain !== expected.chain || entry.network !== expected.network) {
      throw new SummaryDecodeError('asset row is from another context');
    }
  }
  const counts = record(row.counts, 'counts');
  const knownCountAtomic = atomicRequired(counts.knownCountAtomic, 'counts.knownCountAtomic');
  if (knownCountAtomic !== String(assets.length)) {
    throw new SummaryDecodeError('counts disagree with the asset rows');
  }
  const totalCount = counts.totalCount;
  if (totalCount !== null && (typeof totalCount !== 'number' || !Number.isSafeInteger(totalCount) || totalCount < 0)) {
    throw new SummaryDecodeError('counts.totalCount is neither null nor a count');
  }
  const coverage = row.perProtocolCoverage.map(
    (entry, index): SummaryProtocolCoverage => {
      const item = record(entry, 'perProtocolCoverage[' + index + ']');
      const state = text(item.state, 'coverage.state');
      if (!(SUMMARY_COVERAGE_STATES as readonly string[]).includes(state)) {
        throw new SummaryDecodeError('coverage state is not a known state');
      }
      const entryChain = text(item.chain, 'coverage.chain');
      const entryNetwork = text(item.network, 'coverage.network');
      if (entryChain !== expected.chain || entryNetwork !== expected.network) {
        throw new SummaryDecodeError('coverage row is from another context');
      }
      return {
        protocolId: text(item.protocolId, 'coverage.protocolId'),
        chain: entryChain,
        network: entryNetwork,
        state: state as SummaryCoverageState,
        ...(typeof item.reason === 'string' ? { reason: item.reason } : {}),
      };
    },
  );
  // One decision per protocol. Two rows for one protocol would let the view
  // pick whichever it read last, and the roster's whole purpose is that each
  // protocol is accounted for exactly once.
  const coveredProtocols = new Set(coverage.map((entry) => entry.protocolId));
  if (coveredProtocols.size !== coverage.length) {
    throw new SummaryDecodeError('coverage lists one protocol twice');
  }
  const conclusive = coverage.filter(
    (entry) => !INCONCLUSIVE_COVERAGE.has(entry.state),
  );
  if (totalCount !== null) {
    // A stated total is a claim that nothing is missing. It needs conclusive
    // coverage to stand on, and it has to equal the identities actually listed;
    // otherwise the count in the heading contradicts the rows beneath it.
    if (coverage.length === 0 || conclusive.length !== coverage.length) {
      throw new SummaryDecodeError(
        'a stated total needs conclusive coverage for every protocol',
      );
    }
    if (totalCount !== identities.size) {
      throw new SummaryDecodeError('the stated total disagrees with the asset identities');
    }
  }
  const retryAfterSeconds = row.retryAfterSeconds;
  return {
    schemaVersion: EXPLORER_TX_ASSET_SUMMARY_SCHEMA_VERSION,
    chain: expected.chain,
    network: expected.network,
    txid,
    status: text(row.status, 'status'),
    assets,
    perProtocolCoverage: coverage,
    counts: {
      fungibleTypeCountAtomic: atomicRequired(counts.fungibleTypeCountAtomic, 'counts.fungible'),
      collectibleItemCountAtomic: atomicRequired(counts.collectibleItemCountAtomic, 'counts.collectible'),
      otherAssetCountAtomic: atomicRequired(counts.otherAssetCountAtomic, 'counts.other'),
      protocolCountAtomic: atomicRequired(counts.protocolCountAtomic, 'counts.protocol'),
      knownCountAtomic,
      totalCount: totalCount === null ? null : (totalCount as number),
    },
    retryAfterSeconds: typeof retryAfterSeconds === 'number'
      && Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 0
      ? retryAfterSeconds
      : null,
    checkpoint: checkpoint(row.checkpoint),
  };
}

/**
 * The exact decimal quantity as a string, or null when it cannot be stated.
 *
 * String arithmetic only. A null return means the caller must label the atomic
 * digits as atomic units; it never means zero and never means whole tokens.
 *
 * Kept as the decoder's own export and delegated to the shared presenter, so
 * the transaction panel, the address panel and this module cannot scale one
 * quantity three slightly different ways.
 */
export function exactQuantity(quantityAtomic: string | null, assetDecimals: number | null): string | null {
  return exactDecimal(quantityAtomic, assetDecimals);
}

/** True when any consulted source left the inventory inconclusive. */
export function coverageIncomplete(summary: TransactionAssetSummary): boolean {
  return summary.counts.totalCount === null;
}

