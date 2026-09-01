/**
 * Universe Portfolio API contracts, schema `universe-portfolio-v1`.
 *
 * These shapes mirror the versioned contracts served by the overlay under
 * /api/v1/universe/portfolio. Every quantity, price, and total is an exact
 * decimal string; nothing here is ever a JavaScript number that could hold
 * a balance.
 */

export const UNIVERSE_PORTFOLIO_SCHEMA_VERSION = 'universe-portfolio-v1';

export type PortfolioAssetType =
  | 'native'
  | 'fungible'
  | 'nft'
  | 'inscription'
  | 'rare_sat'
  | 'name'
  | 'realm'
  | 'subrealm'
  | 'bitmap'
  | 'position'
  | 'claimable'
  | 'unknown';

export type PortfolioSourceState =
  | 'proven'
  | 'partial'
  | 'outside_coverage'
  | 'pending'
  | 'stale'
  | 'unavailable'
  | 'unsupported';

export type PortfolioValuationState =
  | 'priced'
  | 'unpriced'
  | 'stale-price'
  | 'not-applicable';

export type PortfolioHoldingState =
  | 'active'
  | 'listed'
  | 'locked'
  | 'pending-incoming'
  | 'pending-outgoing'
  | 'claimable'
  | 'unknown';

export interface PortfolioAssetIdentity {
  readonly chain: string;
  readonly network: string;
  readonly protocol: string;
  readonly assetType: PortfolioAssetType;
  readonly assetId: string;
}

export interface PortfolioCustodyRef {
  readonly kind: 'outpoint' | 'protocol-ledger';
  readonly reference: string;
}

export interface PortfolioCheckpoint {
  readonly chain: string;
  readonly network: string;
  readonly heightAtomic: string;
  readonly blockHash: string;
  readonly reorgEpoch: string;
  readonly observedAt: string;
}

export interface PortfolioPriceObservation {
  readonly quoteCurrency: string;
  readonly unitPrice: string;
  readonly source: string;
  readonly methodology: string;
  readonly observedAt: string;
  readonly sampleCountAtomic: string;
  readonly stale: boolean;
}

export interface PortfolioHolding {
  readonly schemaVersion: string;
  readonly assetKey: string;
  readonly identity: PortfolioAssetIdentity;
  readonly displayName?: string;
  readonly ticker?: string;
  readonly collectionId?: string;
  readonly collectionName?: string;
  readonly decimals?: number;
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
  readonly value?: string;
  readonly state: PortfolioHoldingState;
  readonly valuationState: PortfolioValuationState;
  readonly costBasisState: string;
  readonly sourceAuthority: string;
  readonly sourceState: PortfolioSourceState;
  readonly checkpoint: PortfolioCheckpoint | null;
  readonly warnings: readonly string[];
}

export interface PortfolioSourceReport {
  readonly authorityId: string;
  readonly protocols: readonly string[];
  readonly state: PortfolioSourceState;
  readonly checkpoint: PortfolioCheckpoint | null;
  readonly lagAtomic: string | null;
  readonly detail?: string;
}

export interface PortfolioProtocolStatement {
  readonly protocol: string;
  readonly chain: string;
  readonly network: string;
  readonly state: PortfolioSourceState;
  readonly holdings: readonly PortfolioHolding[];
  readonly authorityId: string | null;
  readonly checkpoint: PortfolioCheckpoint | null;
  readonly truncated: boolean;
  readonly warnings: readonly string[];
}

export interface PortfolioEvidenceEnvelope {
  readonly schemaVersion: string;
  readonly chain: string;
  readonly network: string;
  readonly address: string;
  readonly requestedAt: string;
  readonly completedAt: string;
  readonly snapshotId: string;
  readonly chainTip: PortfolioCheckpoint | null;
  readonly sources: readonly PortfolioSourceReport[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly unresolvedCount: number;
  readonly hasMore: boolean;
}

export interface PortfolioValuationCoverage {
  readonly quoteCurrency: string;
  readonly pricedValue: string;
  readonly pricedHoldingCount: number;
  readonly unpricedHoldingCount: number;
  readonly state: 'complete-priced' | 'partially-priced' | 'unpriced';
}

export interface PortfolioSummary {
  readonly envelope: PortfolioEvidenceEnvelope;
  readonly nativeBalance: PortfolioHolding | null;
  readonly totalHoldingCount: number;
  readonly fungibleCount: number;
  readonly nftCount: number;
  readonly inscriptionCount: number;
  readonly protocolCount: number;
  readonly valuation: PortfolioValuationCoverage;
  readonly protocols: readonly PortfolioProtocolStatement[];
}

export interface PortfolioSummaryResponse {
  readonly summary: PortfolioSummary;
  readonly nextCursor: string | null;
}

export interface PortfolioNetworksResponse {
  readonly schemaVersion: string;
  readonly networks: readonly { chain: string; network: string }[];
}

export type PortfolioActivityType =
  | 'receive'
  | 'send'
  | 'self-transfer'
  | 'coinbase-reward'
  | 'unknown';

export interface PortfolioActivityEvent {
  readonly eventId: string;
  readonly chain: string;
  readonly network: string;
  readonly txid: string;
  readonly type: PortfolioActivityType;
  readonly confirmation: 'mempool-candidate' | 'confirmed';
  readonly blockHeightAtomic: string | null;
  readonly blockHash: string | null;
  readonly inflowAtomic: string;
  readonly outflowAtomic: string;
  readonly amountAtomic: string;
  readonly feePaidAtomic: string | null;
  readonly counterparty: string | null;
  readonly warnings: readonly string[];
}

/** The activity route answers a page, or a typed unsupported statement. */
export interface PortfolioActivityPage {
  readonly schemaVersion: string;
  readonly chain: string;
  readonly network: string;
  readonly address: string;
  readonly events?: readonly PortfolioActivityEvent[];
  readonly nextCursor?: string | null;
  readonly state?: 'unsupported';
  readonly detail?: string;
  readonly warnings?: readonly string[];
}
