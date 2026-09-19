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

export const EXPLORER_TX_ASSET_SUMMARY_SCHEMA_VERSION =
  'universe-transaction-asset-summary-v1';

export type SummaryCoverageState =
  | 'complete'
  | 'partial'
  | 'proven-empty'
  | 'candidate-only'
  | 'unsupported-network'
  | 'unconfigured'
  | 'unavailable'
  | 'not-publicly-observable';

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

export interface SummaryEffect {
  eventId: string;
  actionType: string;
  quantityAtomic: string | null;
  accepted: boolean;
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

function asset(value: unknown, index: number): SummaryAsset {
  const what = 'assets[' + index + ']';
  const row = record(value, what);
  const effects = Array.isArray(row.effects) ? row.effects : [];
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
        accepted: effect.accepted === true,
      };
    }),
  };
}

/** The canonical identity key. Never a ticker, a name or a txid. */
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
  const assets = Array.isArray(row.assets) ? row.assets.map(asset) : [];
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
  const coverage = Array.isArray(row.perProtocolCoverage) ? row.perProtocolCoverage : [];
  const retryAfterSeconds = row.retryAfterSeconds;
  return {
    schemaVersion: EXPLORER_TX_ASSET_SUMMARY_SCHEMA_VERSION,
    chain: expected.chain,
    network: expected.network,
    txid,
    status: text(row.status, 'status'),
    assets,
    perProtocolCoverage: coverage.map((entry, index) => {
      const item = record(entry, 'perProtocolCoverage[' + index + ']');
      return {
        protocolId: text(item.protocolId, 'coverage.protocolId'),
        chain: text(item.chain, 'coverage.chain'),
        network: text(item.network, 'coverage.network'),
        state: text(item.state, 'coverage.state') as SummaryCoverageState,
        ...(typeof item.reason === 'string' ? { reason: item.reason } : {}),
      };
    }),
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
  };
}

/**
 * The exact decimal quantity as a string, or null when it cannot be stated.
 *
 * String arithmetic only. A null return means the caller must label the atomic
 * digits as atomic units; it never means zero and never means whole tokens.
 */
export function exactQuantity(quantityAtomic: string | null, assetDecimals: number | null): string | null {
  if (quantityAtomic === null || assetDecimals === null) {return null;}
  if (!ATOMIC_INTEGER.test(quantityAtomic)) {return null;}
  if (assetDecimals === 0) {return quantityAtomic;}
  const padded = quantityAtomic.padStart(assetDecimals + 1, '0');
  const whole = padded.slice(0, padded.length - assetDecimals);
  const fraction = padded.slice(padded.length - assetDecimals).replace(/0+$/, '');
  return fraction.length === 0 ? whole : whole + '.' + fraction;
}

/** True when any consulted source left the inventory inconclusive. */
export function coverageIncomplete(summary: TransactionAssetSummary): boolean {
  return summary.counts.totalCount === null;
}
