/**
 * GENERATED ARTIFACT: do not edit by hand.
 *
 * Generated from the source-of-truth Portfolio v2 contract source in
 * bitcoinuniverseio/backend-apis:
 *
 *   source path: src/universe-portfolio/v2/portfolio-v2-contracts.ts
 *   schema version:        universe-portfolio-v2
 *   source hash (sha256):  c1a533860b85092619102a9dae5a1f6c5c70d70e9977c0f5c59759cc61dfaa85
 *
 * Regenerate with `npm run contract:portfolio-v2` in backend-apis and
 * re-vendor this file; CI fails when this header's hash no longer matches
 * the source files listed above. Generation timestamps are deliberately excluded
 * so deterministic source comparisons stay meaningful.
 *
 * This artifact is self-contained: it embeds the v1 evidence types the v2
 * model names, so a frontend can consume it without importing the backend
 * source tree.
 */

// ------------------------------------------------------------------
// Extracted from src/universe-explorer/contracts/explorer-evidence.ts
// ------------------------------------------------------------------

export interface ExplorerCheckpoint {
    chain: string;
    network: string;
    heightAtomic: string;
    blockHash: string;
    reorgEpoch: string;
    observedAt: string;
}

const DECIMAL_STRING = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** True when the value is a well-formed non-negative decimal string. */
export function isAtomicDecimalString(value: unknown): value is string {
    return typeof value === 'string' && DECIMAL_STRING.test(value);
}

// ------------------------------------------------------------------
// Extracted from src/universe-portfolio/contracts/portfolio-contracts.ts
// ------------------------------------------------------------------

export const UNIVERSE_PORTFOLIO_SCHEMA_VERSION = 'universe-portfolio-v1';

export const UNIVERSE_PORTFOLIO_HOLDING_SCHEMA_VERSION = 'universe-portfolio-holding-v1';

/** Asset categories the normalized model distinguishes. */
export const PORTFOLIO_ASSET_TYPES = [
    'native',
    'fungible',
    'nft',
    'inscription',
    'rare_sat',
    'name',
    'realm',
    'subrealm',
    'bitmap',
    'position',
    'claimable',
    'unknown',
] as const;

export type PortfolioAssetType = (typeof PORTFOLIO_ASSET_TYPES)[number];

/**
 * How completely one source answered for one protocol. The states are
 * deliberately non-collapsible: `proven` is a positive claim over the whole
 * question, `partial` answered some of it, `outside_coverage` means the
 * question falls outside what the source indexes, `pending` means the answer
 * exists but has not been confirmed by the source's own checkpoint yet,
 * `stale` means the answer is older than its freshness budget, `unavailable`
 * means the source failed to answer, and `unsupported` means no configured
 * authority can answer this question at all. None of these may ever be
 * presented as a zero balance.
 */
export const PORTFOLIO_SOURCE_STATES = [
    'proven',
    'partial',
    'outside_coverage',
    'pending',
    'stale',
    'unavailable',
    'unsupported',
] as const;

export type PortfolioSourceState = (typeof PORTFOLIO_SOURCE_STATES)[number];

/** Valuation states an individual holding or a total can carry. */
export type PortfolioValuationState = 'priced' | 'unpriced' | 'stale-price' | 'not-applicable';

/** Cost basis states for a holding. */
export type PortfolioCostBasisState = 'known' | 'partially-known' | 'unknown' | 'not-applicable';

/** Encumbrance and lifecycle states a holding can be in. */
export type PortfolioHoldingState = 'active' | 'listed' | 'locked' | 'pending-incoming' | 'pending-outgoing' | 'claimable' | 'unknown';

const KEY_PART = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface PortfolioAssetIdentity {
    readonly chain: string;
    readonly network: string;
    readonly protocol: string;
    readonly assetType: PortfolioAssetType;
    /**
     * The protocol's own stable identifier for the asset: an inscription id, a
     * rune id in block:tx form, a tick, an atomical id, a sat number, a name.
     * Never a display string.
     */
    readonly assetId: string;
}

/**
 * Builds the globally unambiguous asset key. The first four parts are
 * validated against strict patterns; the assetId is percent-free but
 * otherwise passed through because protocols define their own id alphabets.
 * Returns null instead of a key that could collide or mislead.
 */
export function portfolioAssetKey(identity: PortfolioAssetIdentity): string | null {
    const { chain, network, protocol, assetType, assetId } = identity;
    if (!KEY_PART.test(chain) ||
        !KEY_PART.test(network) ||
        !KEY_PART.test(protocol) ||
        !PORTFOLIO_ASSET_TYPES.includes(assetType)) {
        return null;
    }
    // Asset ids may legitimately contain colons (rune ids, outpoints). The
    // parseability of the whole key rests on the fixed count of the first four
    // segments, not on the assetId being colon-free.
    if (typeof assetId !== 'string' || assetId.length === 0)
        return null;
    if (assetId.length > 256)
        return null;
    return `${chain}:${network}:${protocol}:${assetType}:${assetId}`;
}

/** Splits an asset key back into its identity, or null when malformed. */
export function parsePortfolioAssetKey(key: string): PortfolioAssetIdentity | null {
    const parts = key.split(':');
    if (parts.length < 5)
        return null;
    const [chain, network, protocol, assetType, ...rest] = parts;
    const assetId = rest.join(':');
    if (!KEY_PART.test(chain) ||
        !KEY_PART.test(network) ||
        !KEY_PART.test(protocol) ||
        !PORTFOLIO_ASSET_TYPES.includes(assetType as PortfolioAssetType) ||
        assetId.length === 0) {
        return null;
    }
    return {
        chain,
        network,
        protocol,
        assetType: assetType as PortfolioAssetType,
        assetId,
    };
}

/** A reference to where a holding is held: an outpoint or a protocol ledger. */
export interface PortfolioCustodyRef {
    readonly kind: 'outpoint' | 'protocol-ledger';
    /** `txid:vout` for outpoints; the protocol's ledger id otherwise. */
    readonly reference: string;
}

/** A price observation attached to a holding. Absent means unpriced. */
export interface PortfolioPriceObservation {
    readonly quoteCurrency: string;
    /** Exact decimal string price for one display unit of the asset. */
    readonly unitPrice: string;
    readonly source: string;
    readonly methodology: string;
    readonly observedAt: string;
    readonly sampleCountAtomic: string;
    readonly stale: boolean;
}

/**
 * One normalized holding. Every quantity is an exact decimal string in the
 * asset's atomic unit; `decimals` shifts atomic to display units through
 * exact string arithmetic only.
 */
export interface PortfolioHolding {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_HOLDING_SCHEMA_VERSION;
    readonly assetKey: string;
    readonly identity: PortfolioAssetIdentity;
    readonly displayName?: string;
    readonly ticker?: string;
    readonly collectionId?: string;
    readonly collectionName?: string;
    readonly decimals?: number;
    /** Total quantity in atomic units, or null when a source answered without one. */
    readonly quantityAtomic: string | null;
    readonly spendableAtomic?: string;
    readonly lockedAtomic?: string;
    readonly transferableAtomic?: string;
    readonly pendingIncomingAtomic?: string;
    readonly pendingOutgoingAtomic?: string;
    readonly custody: readonly PortfolioCustodyRef[];
    readonly ownerAddress: string;
    readonly mediaContentId?: string;
    readonly price?: PortfolioPriceObservation;
    /** Exact decimal value in the price's quote currency, present only when priced. */
    readonly value?: string;
    readonly state: PortfolioHoldingState;
    readonly valuationState: PortfolioValuationState;
    readonly costBasisState: PortfolioCostBasisState;
    readonly sourceAuthority: string;
    readonly sourceState: PortfolioSourceState;
    readonly checkpoint: ExplorerCheckpoint | null;
    readonly warnings: readonly string[];
}

/** Per-source accounting inside the evidence envelope. */
export interface PortfolioSourceReport {
    readonly authorityId: string;
    readonly protocols: readonly string[];
    readonly state: PortfolioSourceState;
    readonly checkpoint: ExplorerCheckpoint | null;
    /** Blocks behind the chain reference tip, when both are known. */
    readonly lagAtomic: string | null;
    readonly detail?: string;
}

/**
 * One protocol's statement inside a portfolio answer. An empty holdings
 * array with state `proven` is a proven-empty result; the same array with
 * state `unavailable` says nothing at all. Consumers must branch on `state`
 * before reading `holdings`.
 */
export interface PortfolioProtocolStatement {
    readonly protocol: string;
    readonly chain: string;
    readonly network: string;
    readonly state: PortfolioSourceState;
    readonly holdings: readonly PortfolioHolding[];
    readonly authorityId: string | null;
    readonly checkpoint: ExplorerCheckpoint | null;
    /** True when pagination stopped before the full set was returned. */
    readonly truncated: boolean;
    readonly warnings: readonly string[];
}

/** The §7 evidence envelope every portfolio response carries. */
export interface PortfolioEvidenceEnvelope {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_SCHEMA_VERSION;
    readonly chain: string;
    readonly network: string;
    readonly address: string;
    readonly requestedAt: string;
    readonly completedAt: string;
    readonly snapshotId: string;
    readonly chainTip: ExplorerCheckpoint | null;
    readonly sources: readonly PortfolioSourceReport[];
    readonly warnings: readonly string[];
    readonly errors: readonly string[];
    readonly unresolvedCount: number;
    readonly hasMore: boolean;
}

/** Discloses how much of a total is actually priced. */
export interface PortfolioValuationCoverage {
    readonly quoteCurrency: string;
    /** Sum of `value` across priced holdings, exact decimal string. */
    readonly pricedValue: string;
    readonly pricedHoldingCount: number;
    readonly unpricedHoldingCount: number;
    /**
     * The truthful description of the total: `complete-priced` when every
     * holding carries a defensible price, `partially-priced` when some do,
     * `unpriced` when none do.
     */
    readonly state: 'complete-priced' | 'partially-priced' | 'unpriced';
}

/**
 * Sums exact decimal strings without floating point. Values must be
 * non-negative decimals; any malformed input makes the sum null rather than
 * a partial number presented as a whole.
 */
export function sumDecimalStrings(values: readonly string[]): string | null {
    let totalUnits = 0n;
    let scale = 0;
    const scaled: {
        units: bigint;
        fraction: string;
    }[] = [];
    for (const value of values) {
        if (!isAtomicDecimalString(value))
            return null;
        const [whole, fraction = ''] = value.split('.');
        scaled.push({ units: BigInt(whole), fraction });
        if (fraction.length > scale)
            scale = fraction.length;
    }
    for (const { units, fraction } of scaled) {
        const padded = fraction.padEnd(scale, '0');
        totalUnits +=
            units * 10n ** BigInt(scale) + (padded === '' ? 0n : BigInt(padded));
    }
    if (scale === 0)
        return totalUnits.toString();
    const text = totalUnits.toString().padStart(scale + 1, '0');
    const whole = text.slice(0, text.length - scale);
    const fraction = text.slice(text.length - scale).replace(/0+$/, '');
    return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

/**
 * Multiplies an exact decimal quantity by an exact decimal unit price.
 * Returns an exact decimal string, or null for malformed input.
 */
export function multiplyDecimalStrings(quantity: string, unitPrice: string): string | null {
    if (!isAtomicDecimalString(quantity) || !isAtomicDecimalString(unitPrice)) {
        return null;
    }
    const parse = (value: string): {
        units: bigint;
        scale: number;
    } => {
        const [whole, fraction = ''] = value.split('.');
        return {
            units: BigInt(whole + fraction),
            scale: fraction.length,
        };
    };
    const a = parse(quantity);
    const b = parse(unitPrice);
    const product = a.units * b.units;
    const scale = a.scale + b.scale;
    if (scale === 0)
        return product.toString();
    const text = product.toString().padStart(scale + 1, '0');
    const whole = text.slice(0, text.length - scale);
    const fraction = text.slice(text.length - scale).replace(/0+$/, '');
    return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

/**
 * Derives the valuation coverage disclosure for a set of holdings. A
 * holding without a `value` counts as unpriced; the priced total only sums
 * holdings that carry an exact value in the same quote currency.
 */
export function portfolioValuationCoverage(holdings: readonly PortfolioHolding[], quoteCurrency: string): PortfolioValuationCoverage {
    const pricedValues: string[] = [];
    let unpriced = 0;
    for (const holding of holdings) {
        if (holding.valuationState === 'not-applicable')
            continue;
        if (holding.value !== undefined &&
            holding.price !== undefined &&
            holding.price.quoteCurrency === quoteCurrency &&
            holding.valuationState === 'priced') {
            pricedValues.push(holding.value);
        }
        else {
            unpriced += 1;
        }
    }
    const pricedValue = sumDecimalStrings(pricedValues) ?? '0';
    const state = unpriced === 0 && pricedValues.length > 0
        ? 'complete-priced'
        : pricedValues.length > 0
            ? 'partially-priced'
            : 'unpriced';
    return {
        quoteCurrency,
        pricedValue,
        pricedHoldingCount: pricedValues.length,
        unpricedHoldingCount: unpriced,
        state,
    };
}

// ------------------------------------------------------------------
// Shared v2 model from src/universe-portfolio/v2/portfolio-v2-contracts.ts
// ------------------------------------------------------------------

/** Re-exported so v2 consumers never import across the v1 boundary blindly. */
export type PortfolioDataState = PortfolioSourceState;

export const PORTFOLIO_DATA_STATES: readonly PortfolioDataState[] = [
    'proven',
    'partial',
    'outside_coverage',
    'pending',
    'stale',
    'unavailable',
    'unsupported',
];

export const UNIVERSE_PORTFOLIO_V2_SCHEMA_VERSION = 'universe-portfolio-v2';

export const UNIVERSE_PORTFOLIO_V2_NETWORKS_SCHEMA = 'universe-portfolio-v2-networks-v1';

export const UNIVERSE_PORTFOLIO_V2_SUMMARY_SCHEMA = 'universe-portfolio-v2-summary-v1';

export const UNIVERSE_PORTFOLIO_V2_HOLDINGS_SCHEMA = 'universe-portfolio-v2-holdings-v1';

export const UNIVERSE_PORTFOLIO_UTXO_SCHEMA = 'universe-portfolio-utxo-v1';

export const UNIVERSE_PORTFOLIO_ACTIVITY_V2_SCHEMA = 'universe-portfolio-activity-v2';

export const UNIVERSE_PORTFOLIO_SNAPSHOT_SCHEMA = 'universe-portfolio-snapshot-v1';

export const UNIVERSE_PORTFOLIO_DELTA_SCHEMA = 'universe-portfolio-delta-v1';

export const UNIVERSE_PORTFOLIO_V2_PERFORMANCE_SCHEMA = 'universe-portfolio-v2-performance-v1';

export const UNIVERSE_PORTFOLIO_V2_COUNTERPARTIES_SCHEMA = 'universe-portfolio-v2-counterparties-v1';

export const UNIVERSE_PORTFOLIO_V2_COVERAGE_SCHEMA = 'universe-portfolio-v2-coverage-v1';

/** Exact integer (satoshi counts, heights): an exact decimal string. */
export type ExactInteger = string;

/** Exact decimal (prices, values): an exact decimal string. */
export type ExactDecimal = string;

/**
 * Identifies one account a server answer speaks about. The public API never
 * knows local portfolio identities: `portfolioId` is always `external` on a
 * server answer and the client's aggregation engine substitutes the local
 * account identity when it merges snapshots into a portfolio.
 */
export interface PortfolioAccountRef {
    readonly portfolioId: string;
    readonly accountId: string;
    readonly addressId: string;
    readonly chain: string;
    readonly network: string;
    readonly address: string;
}

export const EXTERNAL_PORTFOLIO_ID = 'external';

/** The shared native-asset key for one chain/network pair. */
export function PORTFOLIO_NATIVE_ASSET_KEY(chain: string, network: string): string {
    return `${chain}:${network}:base:native:${chain}`;
}

/** Builds the server-side account reference for one address answer. */
export function externalAccountRef(chain: string, network: string, address: string): PortfolioAccountRef {
    return {
        portfolioId: EXTERNAL_PORTFOLIO_ID,
        accountId: address,
        addressId: address,
        chain,
        network,
        address,
    };
}

/** Where one quantity sits: an outpoint, a protocol ledger, or a manual note. */
export interface PortfolioHoldingLocation {
    readonly account: PortfolioAccountRef;
    readonly custodyKind: 'outpoint' | 'protocol-ledger' | 'manual';
    /** `txid:vout` for outpoints; the protocol ledger id otherwise. */
    readonly custodyReference: string;
    readonly quantityAtomic: ExactDecimal | null;
    readonly state: PortfolioDataState;
    readonly checkpoint: ExplorerCheckpoint | null;
}

/** The pessimistic fold over source states: the worst witnessed state wins. */
export function foldDataStates(states: readonly PortfolioDataState[]): PortfolioDataState {
    let worst: PortfolioDataState = 'proven';
    for (const state of states) {
        if (STATE_SEVERITY[state] > STATE_SEVERITY[worst])
            worst = state;
    }
    return worst;
}

const STATE_SEVERITY: Record<PortfolioDataState, number> = {
    proven: 0,
    unsupported: 1,
    outside_coverage: 2,
    pending: 3,
    stale: 4,
    partial: 5,
    unavailable: 6,
};

/** A v2 source report: the v1 report plus the source's own release identity. */
export interface PortfolioV2SourceReport {
    readonly authorityId: string;
    readonly protocols: readonly string[];
    readonly state: PortfolioDataState;
    readonly checkpoint: ExplorerCheckpoint | null;
    readonly lagAtomic: ExactInteger | null;
    /** The source release the answer came from, when the authority discloses one. */
    readonly releaseSha: string | null;
    readonly detail?: string;
}

/** Per-asset movement inside one semantic event, signed in atomic units. */
export interface PortfolioEventHolding {
    readonly assetKey: string;
    readonly displayName?: string;
    readonly ticker?: string;
    readonly decimals?: number;
    /** Signed quantity this event moved for the addressed side, exact decimal. */
    readonly quantityDeltaAtomic: string;
    readonly direction: 'in' | 'out' | 'internal' | 'neutral' | 'unknown';
}

/** Confirmation lifecycle of one semantic event. */
export type PortfolioConfirmationState = 'mempool' | 'confirmed' | 'replaced' | 'reorged' | 'dropped' | 'unknown';

export const PORTFOLIO_CONFIRMATION_STATES: readonly PortfolioConfirmationState[] = ['mempool', 'confirmed', 'replaced', 'reorged', 'dropped', 'unknown'];

/**
 * What a semantic event is. Base-chain evidence proves the first six;
 * protocol evidence proves the rest when an authority serves it. An event
 * the evidence cannot name stays `unknown`; it is never forced into a
 * better-sounding category.
 */
export type PortfolioEventType = 'receive' | 'send' | 'internal-transfer' | 'coinbase-reward' | 'fee' | 'mint' | 'burn' | 'deploy' | 'register' | 'transfer' | 'list' | 'cancel-listing' | 'sale' | 'lock' | 'unlock' | 'claim' | 'protocol-state-change' | 'unknown';

export const PORTFOLIO_EVENT_TYPES: readonly PortfolioEventType[] = [
    'receive',
    'send',
    'internal-transfer',
    'coinbase-reward',
    'fee',
    'mint',
    'burn',
    'deploy',
    'register',
    'transfer',
    'list',
    'cancel-listing',
    'sale',
    'lock',
    'unlock',
    'claim',
    'protocol-state-change',
    'unknown',
];

export type PortfolioEventDirection = 'in' | 'out' | 'internal' | 'neutral' | 'unknown';

/**
 * One portfolio-wide semantic event. Schema
 * `universe-portfolio-activity-v2`. Deterministic per (chain, network,
 * txid, address scope): the eventId is stable across reads.
 */
export interface PortfolioSemanticEvent {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_ACTIVITY_V2_SCHEMA;
    readonly eventId: string;
    readonly chain: string;
    readonly network: string;
    readonly txid: string;
    readonly blockHeightAtomic: ExactInteger | null;
    readonly blockHash: string | null;
    readonly timestamp: string | null;
    readonly confirmationState: PortfolioConfirmationState;
    readonly eventType: PortfolioEventType;
    readonly direction: PortfolioEventDirection;
    readonly accountRefs: readonly PortfolioAccountRef[];
    /** Raw addresses only; labels are a client-local concern. */
    readonly rawCounterparties: readonly string[];
    readonly holdings: readonly PortfolioEventHolding[];
    /** Net native-unit effect for the addressed side, signed exact decimal. */
    readonly nativeValueAtomic: ExactInteger | null;
    readonly feeAtomic: ExactInteger | null;
    readonly valuationAtEvent: PortfolioPriceObservation | null;
    readonly sourceState: PortfolioDataState;
    readonly sourceReports: readonly PortfolioV2SourceReport[];
    readonly warnings: readonly string[];
}

/** One page of the semantic activity ledger. */
export interface PortfolioSemanticActivityPage {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_ACTIVITY_V2_SCHEMA;
    readonly chain: string;
    readonly network: string;
    readonly address: string;
    readonly account: PortfolioAccountRef;
    readonly events: readonly PortfolioSemanticEvent[];
    readonly nextCursor: string | null;
    readonly checkpoint: ExplorerCheckpoint | null;
    readonly sourceState: PortfolioDataState;
    readonly requestedAt: string;
    readonly completedAt: string;
    readonly warnings: readonly string[];
}

/**
 * One unspent output with its full asset composition. Schema
 * `universe-portfolio-utxo-v1`. `coinbase: false` is only meaningful
 * together with the absence of a `coinbase-state-unproven` warning; a
 * warning names what was not proven so no field ever lies.
 */
export interface PortfolioUtxo {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_UTXO_SCHEMA;
    readonly chain: string;
    readonly network: string;
    readonly txid: string;
    readonly vout: number;
    readonly valueAtomic: ExactInteger;
    readonly scriptType: string;
    readonly address: string | null;
    readonly confirmationsAtomic: ExactInteger;
    readonly blockHeightAtomic: ExactInteger | null;
    readonly blockHash: string | null;
    readonly firstSeenAt: string | null;
    readonly spent: boolean;
    readonly pending: boolean;
    readonly coinbase: boolean;
    readonly maturityHeightAtomic: ExactInteger | null;
    readonly assetState: PortfolioDataState;
    readonly assets: readonly PortfolioHolding[];
    readonly warnings: readonly string[];
    readonly sourceReports: readonly PortfolioV2SourceReport[];
}

export interface PortfolioUtxoPage {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_UTXO_SCHEMA;
    readonly chain: string;
    readonly network: string;
    readonly address: string;
    readonly account: PortfolioAccountRef;
    readonly utxos: readonly PortfolioUtxo[];
    readonly nextCursor: string | null;
    readonly sourceState: PortfolioDataState;
    readonly requestedAt: string;
    readonly completedAt: string;
    readonly warnings: readonly string[];
}

/** A requested point in time for a historical reconstruction. */
export interface PortfolioRequestedPoint {
    readonly timestamp?: string;
    readonly blockHeightAtomic?: ExactInteger;
}

/** Where the reconstruction actually landed. */
export interface PortfolioResolvedPoint {
    readonly timestamp: string | null;
    readonly blockHeightAtomic: ExactInteger | null;
    readonly blockHash: string | null;
}

/**
 * The address's holdings at one historical point. Schema
 * `universe-portfolio-snapshot-v1`. A protocol holding is never inferred
 * from its current state: history the sources cannot reconstruct is named
 * in `warnings` and folded into `state`, never drawn as fact.
 */
export interface PortfolioHistoricalSnapshot {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_SNAPSHOT_SCHEMA;
    readonly chain: string;
    readonly network: string;
    readonly address: string;
    readonly account: PortfolioAccountRef;
    readonly requestedPoint: PortfolioRequestedPoint;
    readonly resolvedPoint: PortfolioResolvedPoint;
    readonly holdings: readonly PortfolioHolding[];
    readonly nativeBalance: PortfolioHolding | null;
    readonly valuation: PortfolioValuationCoverage;
    readonly state: PortfolioDataState;
    readonly sources: readonly PortfolioV2SourceReport[];
    readonly warnings: readonly string[];
}

/** How one asset moved between two snapshots. */
export interface PortfolioHoldingDelta {
    readonly assetKey: string;
    readonly displayName?: string;
    readonly ticker?: string;
    readonly decimals?: number;
    readonly fromQuantityAtomic: ExactDecimal | null;
    readonly toQuantityAtomic: ExactDecimal | null;
    /** Signed change, exact decimal; null when either side is unknown. */
    readonly quantityDeltaAtomic: ExactDecimal | null;
    readonly fromLocations: readonly PortfolioHoldingLocation[];
    readonly toLocations: readonly PortfolioHoldingLocation[];
}

/** Which coverage changed between two snapshots, and how. */
export interface PortfolioCoverageDelta {
    readonly authorityId: string;
    readonly fromState: PortfolioDataState;
    readonly toState: PortfolioDataState;
    readonly detail: string;
}

/**
 * The difference between two historical snapshots. Schema
 * `universe-portfolio-delta-v1`. Every effect is a signed exact decimal in
 * the snapshot quote currency, or null when the inputs cannot prove it;
 * effects are never mixed across quote currencies.
 */
export interface PortfolioDelta {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_DELTA_SCHEMA;
    readonly chain: string;
    readonly network: string;
    readonly address: string;
    readonly from: PortfolioHistoricalSnapshot;
    readonly to: PortfolioHistoricalSnapshot;
    readonly acquired: readonly PortfolioHoldingDelta[];
    readonly disposed: readonly PortfolioHoldingDelta[];
    readonly quantityChanged: readonly PortfolioHoldingDelta[];
    /** Value change explained purely by unit-price movement, when provable. */
    readonly priceEffect: ExactDecimal | null;
    /** Value change explained by external inflows minus outflows, when provable. */
    readonly externalFlowEffect: ExactDecimal | null;
    /** Value moved between locations of the included scope; movement, not P&L. */
    readonly internalTransferEffect: ExactDecimal | null;
    /** Native units consumed by fees in the window, when provable. */
    readonly feeEffect: ExactDecimal | null;
    /** The residual the two snapshots cannot attribute, when provable. */
    readonly unresolvedEffect: ExactDecimal | null;
    readonly coverageChanges: readonly PortfolioCoverageDelta[];
    readonly warnings: readonly string[];
}

/** Performance answer for one address, reusing the v1 FIFO P&L evidence. */
export interface PortfolioPerformanceReport {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_V2_PERFORMANCE_SCHEMA;
    readonly chain: string;
    readonly network: string;
    readonly address: string;
    readonly account: PortfolioAccountRef;
    readonly sourceState: PortfolioDataState;
    readonly quoteCurrency: string;
    readonly realizedPnl: string | null;
    readonly unrealizedPnl: string | null;
    readonly totalPnl: string | null;
    readonly invested: string | null;
    readonly proceeds: string | null;
    readonly fees: string | null;
    /** Per-asset attribution, proven assets only. */
    readonly attribution: readonly {
        readonly assetKey: string;
        readonly displayName?: string;
        readonly ticker?: string;
        readonly realizedPnl: string | null;
        readonly unrealizedPnl: string | null;
    }[];
    readonly methodology: string;
    readonly warnings: readonly string[];
    readonly requestedAt: string;
    readonly completedAt: string;
}

/** One deterministic counterparty aggregate: raw addresses, never labels. */
export interface PortfolioCounterparty {
    readonly address: string;
    readonly role: 'sending' | 'receiving' | 'both';
    readonly eventCount: number;
    readonly inflowAtomic: ExactInteger;
    readonly outflowAtomic: ExactInteger;
    readonly firstSeenAt: string | null;
    readonly lastSeenAt: string | null;
    readonly assetKeys: readonly string[];
}

export interface PortfolioCounterpartyPage {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_V2_COUNTERPARTIES_SCHEMA;
    readonly chain: string;
    readonly network: string;
    readonly address: string;
    readonly counterparties: readonly PortfolioCounterparty[];
    readonly nextCursor: string | null;
    readonly sourceState: PortfolioDataState;
    readonly warnings: readonly string[];
    readonly requestedAt: string;
    readonly completedAt: string;
}

/** One v2 network entry: the pair plus what this release can prove there. */
export interface PortfolioV2Network {
    readonly chain: string;
    readonly network: string;
    readonly nativeAssetKey: string;
    readonly nativeTicker: string;
    readonly nativeDecimals: number;
    readonly addressHistory: boolean;
    readonly utxoComposition: boolean;
    readonly historicalSnapshots: boolean;
}

export interface PortfolioV2NetworksResponse {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_V2_NETWORKS_SCHEMA;
    /** The serving release identity, so clients can pin what they read. */
    readonly releaseSha: string | null;
    readonly contractVersion: string;
    readonly networks: readonly PortfolioV2Network[];
}

/** The v2 summary: the v1 summary plus location rollups and a folded state. */
export interface PortfolioV2SummaryResponse {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_V2_SUMMARY_SCHEMA;
    readonly account: PortfolioAccountRef;
    readonly envelope: PortfolioEvidenceEnvelope;
    readonly aggregateState: PortfolioDataState;
    readonly nativeBalance: PortfolioHolding | null;
    readonly valuation: PortfolioValuationCoverage;
    readonly counts: {
        readonly totalHoldingCount: number;
        readonly fungibleCount: number;
        readonly nftCount: number;
        readonly inscriptionCount: number;
        readonly protocolCount: number;
    };
    readonly protocols: readonly PortfolioProtocolStatement[];
}

/** A holding with its full per-location breakdown. */
export interface PortfolioV2Holding {
    readonly holding: PortfolioHolding;
    readonly locations: readonly PortfolioHoldingLocation[];
}

export interface PortfolioV2HoldingsPage {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_V2_HOLDINGS_SCHEMA;
    readonly account: PortfolioAccountRef;
    readonly envelope: PortfolioEvidenceEnvelope;
    readonly holdings: readonly PortfolioV2Holding[];
    readonly nextCursor: string | null;
    readonly sourceState: PortfolioDataState;
}

export interface PortfolioV2CoverageEntry {
    readonly protocol: string;
    readonly servingMode: string;
    readonly authorityId: string | null;
    readonly state: PortfolioDataState;
    readonly checkpoint: ExplorerCheckpoint | null;
    readonly releaseSha: string | null;
    readonly detail: string | null;
}

export interface PortfolioV2CoverageResponse {
    readonly schemaVersion: typeof UNIVERSE_PORTFOLIO_V2_COVERAGE_SCHEMA;
    readonly account: PortfolioAccountRef;
    readonly envelope: PortfolioEvidenceEnvelope;
    readonly roster: readonly PortfolioV2CoverageEntry[];
}

// ---------------------------------------------------------------------------
// Cursor: one route-scoped, strictly validated continuation token format.
// ---------------------------------------------------------------------------
export const V2_CURSOR_ROUTES = [
    'holdings',
    'activity',
    'utxos',
    'counterparties',
] as const;

export type V2CursorRoute = (typeof V2_CURSOR_ROUTES)[number];

export interface PortfolioV2Cursor {
    readonly version: 2;
    readonly route: V2CursorRoute;
    /** Route-specific continuation payload; opaque outside its route. */
    readonly position: Readonly<Record<string, string>>;
}

const CURSOR_TOKEN = /^[A-Za-z0-9_-]{1,512}$/;

const CURSOR_KEY = /^[a-z][a-z0-9-]{0,31}$/;

const MAXIMUM_CURSOR_BYTES = 4096;

/** Encodes a v2 cursor for transport. Base64url of the JSON form. */
export function encodePortfolioV2Cursor(cursor: PortfolioV2Cursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decodes and validates a transported v2 cursor. Null when malformed. */
export function decodePortfolioV2Cursor(encoded: string, route: V2CursorRoute): PortfolioV2Cursor | null {
    if (typeof encoded !== 'string' ||
        encoded.length === 0 ||
        Buffer.byteLength(encoded, 'utf8') > MAXIMUM_CURSOR_BYTES ||
        !/^[A-Za-z0-9_-]+$/.test(encoded)) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    }
    catch {
        return null;
    }
    if (parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        (parsed as {
            version?: unknown;
        }).version !== 2 ||
        (parsed as {
            route?: unknown;
        }).route !== route) {
        return null;
    }
    const position = (parsed as {
        position?: unknown;
    }).position;
    if (position === null ||
        typeof position !== 'object' ||
        Array.isArray(position)) {
        return null;
    }
    const validated: Record<string, string> = {};
    for (const [key, value] of Object.entries(position as Record<string, unknown>)) {
        if (!CURSOR_KEY.test(key) ||
            typeof value !== 'string' ||
            !CURSOR_TOKEN.test(value)) {
            return null;
        }
        validated[key] = value;
    }
    return { version: 2, route, position: validated };
}

// ---------------------------------------------------------------------------
// Exact arithmetic shared by every v2 derivation.
// ---------------------------------------------------------------------------
const V2_DECIMAL_STRING = /^\d+(\.\d+)?$/;

const V2_SIGNED_DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

export function isExactDecimal(value: unknown): value is string {
    return typeof value === 'string' && V2_DECIMAL_STRING.test(value);
}

export function isSignedExactDecimal(value: unknown): value is string {
    return typeof value === 'string' && V2_SIGNED_DECIMAL_STRING.test(value);
}

function splitDecimal(value: string): {
    units: bigint;
    scale: number;
} {
    const [whole, fraction = ''] = value.split('.');
    return { units: BigInt(whole + fraction), scale: fraction.length };
}

function joinDecimal(units: bigint, scale: number): string {
    if (scale === 0)
        return units.toString();
    const negative = units < 0n;
    const text = (negative ? -units : units).toString().padStart(scale + 1, '0');
    const whole = text.slice(0, text.length - scale);
    const fraction = text.slice(text.length - scale).replace(/0+$/, '');
    const joined = fraction.length === 0 ? whole : `${whole}.${fraction}`;
    return negative ? `-${joined}` : joined;
}

/** Signed exact addition; null when either input is malformed. */
export function v2Add(a: string, b: string): string | null {
    if (!isSignedExactDecimal(a) || !isSignedExactDecimal(b))
        return null;
    const left = splitDecimal(a);
    const right = splitDecimal(b);
    const scale = Math.max(left.scale, right.scale);
    return joinDecimal(left.units * 10n ** BigInt(scale - left.scale) +
        right.units * 10n ** BigInt(scale - right.scale), scale);
}

/** Signed exact subtraction; null when either input is malformed. */
export function v2Subtract(a: string, b: string): string | null {
    if (!isSignedExactDecimal(b))
        return null;
    const negated = b.startsWith('-') ? b.slice(1) : `-${b}`;
    return v2Add(a, negated);
}

/** Signed exact multiplication; null when either input is malformed. */
export function v2Multiply(a: string, b: string): string | null {
    if (!isSignedExactDecimal(a) || !isSignedExactDecimal(b))
        return null;
    const left = splitDecimal(a);
    const right = splitDecimal(b);
    return joinDecimal(left.units * right.units, left.scale + right.scale);
}

/** Signed exact comparison: -1, 0, or 1. Null when either input is malformed. */
export function v2Compare(a: string, b: string): -1 | 0 | 1 | null {
    if (!isSignedExactDecimal(a) || !isSignedExactDecimal(b))
        return null;
    const left = splitDecimal(a);
    const right = splitDecimal(b);
    const scale = Math.max(left.scale, right.scale);
    const leftUnits = left.units * 10n ** BigInt(scale - left.scale);
    const rightUnits = right.units * 10n ** BigInt(scale - right.scale);
    return leftUnits === rightUnits ? 0 : leftUnits < rightUnits ? -1 : 1;
}

/** Sums signed exact decimals; null when any input is malformed. */
export function v2Sum(values: readonly string[]): string | null {
    let total = '0';
    for (const value of values) {
        const next = v2Add(total, value);
        if (next === null)
            return null;
        total = next;
    }
    return total;
}
