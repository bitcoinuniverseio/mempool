// Type definitions mirroring the Universe protocol overlay API.
// All numeric amounts are transported as strings.

export interface ProtocolCoverage {
  state?: string;
  fromHeight?: string;
  toHeight?: string;
  note?: string;
  [key: string]: unknown;
}

export interface ExplorerProtocolDefinition {
  schemaVersion: string;
  id: string;
  aliases: string[];
  displayName: string;
  shortName: string;
  family: string;
  chain: string;
  networks: string[];
  icon: string;
  visualToken: string;
  implementedReadOperations: string[];
  authorizedReadOperations: string[];
  releaseStatus: string;
  indexerAuthority?: string;
  coverage: ProtocolCoverage | string | null;
}

export interface ProtocolsResponse {
  registryVersion: string;
  primaryStrip: string[];
  protocols: ExplorerProtocolDefinition[];
}

export type SourceStatus =
  'ready' | 'stale' | 'unreachable' | 'unconfigured' | 'degraded';

export interface SourceCheckpoint {
  heightAtomic: string;
  blockHash: string;
  observedAt: string;
}

export interface SourceEntry {
  authorityId: string;
  protocols: string[];
  ready: boolean;
  status: SourceStatus | string;
  checkpoint: SourceCheckpoint | null;
  checkedAt: string;
  /** Blocks behind the chain reference, as a decimal string. */
  lagBlocks?: string | null;
  /** When this authority last answered ready with a usable checkpoint. */
  lastSuccessAt?: string | null;
  /** Consecutive failed checks, so a flapping authority is visible as one. */
  consecutiveFailures?: number;
}

export interface SourcesResponse {
  generatedAt: string;
  sources: SourceEntry[];
}

export interface SourceCounts {
  configured: number;
  ready: number;
  /** Reachable and answering, but too far behind to describe the present. */
  stale: number;
  degraded: number;
  unreachable: number;
}

export interface StatusResponse {
  registryVersion: string;
  protocolCount: number;
  sources: SourceCounts;
  generatedAt: string;
}

/** Release identity reported by the explorer backend. */
export interface BackendInfo {
  hostname?: string;
  version: string;
  gitCommit: string;
  backend?: string;
  coreVersion?: string;
}

// --- Transaction asset flow ---

export interface ExplorerAssetRef {
  protocolId: string;
  assetId: string;
  displayName?: string;
  ticker?: string;
  assetKind: string;
}

export interface ExplorerEvidenceCheckpoint {
  chain?: string;
  network?: string;
  heightAtomic: string;
  blockHash: string;
  reorgEpoch?: string;
  observedAt?: string;
}

export interface ExplorerPositionEvidence {
  authorityId: string;
  protocolId?: string;
  coverage: string;
  negativeCompleteness?: boolean;
  checkpoint?: ExplorerEvidenceCheckpoint;
  [key: string]: unknown;
}

export type ExplorerSatRarity =
  'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

/** One satoshi whose Rodarmor rarity is above common. */
export interface ExplorerNotableSat {
  satAtomic: string;
  rarity: ExplorerSatRarity;
  heightAtomic: string;
}

export interface ExplorerOutpointPosition {
  outpoint: string;
  vout: number;
  valueSatsAtomic: string;
  asset: ExplorerAssetRef;
  quantityAtomic?: string;
  satRanges?: unknown[];
  notableSats?: ExplorerNotableSat[];
  notableSatsTruncated?: boolean;
  ownerAddress?: string;
  state: string;
  evidence: ExplorerPositionEvidence;
}

export interface ExplorerAssetAction {
  eventId: string;
  protocolId: string;
  actionType: string;
  asset?: ExplorerAssetRef;
  quantityAtomic?: string;
  inputOutpoints?: string[];
  outputOutpoints?: string[];
  evidence: ExplorerPositionEvidence;
}

export type ExplorerTransactionFlowStatus =
  'mempool-candidate' | 'confirmed' | 'replaced' | 'orphaned' | 'enrichment-pending';

export interface ExplorerTransactionAssetFlow {
  schemaVersion: string;
  chain: string;
  network: string;
  txid: string;
  status: ExplorerTransactionFlowStatus;
  checkpoint?: ExplorerEvidenceCheckpoint;
  coinbase?: boolean;
  inputs: ExplorerOutpointPosition[];
  outputs: ExplorerOutpointPosition[];
  actions: ExplorerAssetAction[];
  sourceEvidence: ExplorerPositionEvidence[];
  /** True when every outpoint the authority covers was resolved. */
  complete: boolean;
  /** Outpoints the authority was asked about and could not answer. */
  unknownAttachmentCount: number;
  /**
   * Outpoints the authority answered for but keeps no inventory on. Already
   * spent outputs land here, so this is a coverage boundary, not a failure.
   */
  outOfCoverageCount: number;
}

// error-shaped body the overlay can return instead of a flow
export interface UniverseApiError {
  error: string;
  [key: string]: unknown;
}

// --- Outpoint enrichment ---

export type OutpointEnrichmentStatus =
  'ok' | 'unconfigured' | 'unavailable' | 'stale' | 'malformed' | 'not-indexed';

export interface OutpointEnrichment {
  outpoint: string;
  status: OutpointEnrichmentStatus;
  positions: ExplorerOutpointPosition[];
  coveredProtocolIds: string[];
  unknownAttachments: boolean;
  checkpoint: ExplorerEvidenceCheckpoint | null;
}

export interface OutpointBatchResponse {
  results: OutpointEnrichment[];
}

// --- Transaction flow batch ---

export type TransactionBatchStatus =
  'ok' | 'invalid' | 'not-found' | 'unconfigured' | 'unavailable';

export interface TransactionBatchItem {
  txid: string;
  status: TransactionBatchStatus;
  flow: ExplorerTransactionAssetFlow | null;
}

export interface TransactionBatchResponse {
  results: TransactionBatchItem[];
}

// --- Asset lookups ---

export type AssetLookupStatus =
  'ok' | 'not-found' | 'unconfigured' | 'unavailable' | 'malformed';

export interface AssetLookupResult<T> {
  schemaVersion: string;
  status: AssetLookupStatus;
  authorityId: string;
  checkpoint: ExplorerEvidenceCheckpoint | null;
  value: T | null;
}

export interface OrdInscriptionView {
  id: string;
  numberAtomic: string;
  address: string | null;
  contentType: string | null;
  contentLengthAtomic: string | null;
  heightAtomic: string | null;
  feeAtomic: string | null;
  valueAtomic: string | null;
  satAtomic: string | null;
  satpoint: string | null;
  timestampAtomic: string | null;
  charms: string[];
  parents: string[];
  childCountAtomic: string | null;
  rune: string | null;
  metaprotocol: string | null;
}

export interface OrdRuneTermsView {
  amountAtomic: string | null;
  capAtomic: string | null;
  heightStartAtomic: string | null;
  heightEndAtomic: string | null;
  offsetStartAtomic: string | null;
  offsetEndAtomic: string | null;
}

export interface OrdRuneView {
  id: string;
  spacedRune: string;
  rune: string;
  symbol: string | null;
  divisibilityAtomic: string;
  blockAtomic: string | null;
  numberAtomic: string | null;
  mintsAtomic: string;
  burnedAtomic: string;
  premineAtomic: string;
  etchingTxid: string | null;
  timestampAtomic: string | null;
  turbo: boolean;
  mintable: boolean;
  terms: OrdRuneTermsView | null;
  parentInscriptionId: string | null;
}

export interface OrdSatView {
  numberAtomic: string;
  rarity: string;
  name: string | null;
  decimal: string | null;
  degree: string | null;
  percentile: string | null;
  blockAtomic: string | null;
  cycleAtomic: string | null;
  epochAtomic: string | null;
  periodAtomic: string | null;
  offsetAtomic: string | null;
  timestampAtomic: string | null;
  satpoint: string | null;
  address: string | null;
  inscriptions: string[];
}

export interface OrdBlockInscriptionsView {
  ids: string[];
  more: boolean;
}

// --- Multi-chain explorer ---

export type ExplorerChain = 'bitcoin' | 'dogecoin' | 'zcash';
export type ExplorerNetwork = 'mainnet' | 'testnet' | 'regtest';

export interface ChainCapabilityProtocol {
  protocolId: string;
  state: 'ready' | 'degraded' | 'unavailable';
  coverage: 'complete' | 'partial' | 'unavailable';
  updatedAt: string | null;
  lagBlocksAtomic: string | null;
  degradedReasons: string[];
}

export interface ChainCapabilityEnvelope {
  schemaVersion: string;
  chain: ExplorerChain;
  network: ExplorerNetwork;
  asset: {
    symbol: string;
    name: string;
    precision: number;
    atomicUnit: string;
  };
  ready: boolean;
  tip: SourceCheckpoint | null;
  sync: {
    state: 'ready' | 'degraded' | 'unavailable';
    initialBlockDownload: boolean | null;
    progressDecimal: string | null;
    updatedAt: string | null;
  };
  mempool: {
    supported: boolean;
    state: 'ready' | 'degraded' | 'unavailable';
    completeness: 'complete' | 'partial' | 'unavailable';
    snapshotId: string | null;
    sequenceAtomic: string | null;
    observedAt: string | null;
  };
  reads: {
    transaction: boolean;
    block: boolean;
    address: boolean;
    outpoint: boolean;
    feeEstimates: boolean;
    projectedBlocks: boolean;
    /**
     * A weaker claim than projected blocks: the pending set grouped under
     * the chain's own fee policy, never a forecast of the next block.
     */
    candidateBuckets?: boolean;
  };
  protocols: ChainCapabilityProtocol[];
  coverage: {
    confirmedHistory: 'complete' | 'partial' | 'unavailable';
    addressHistory: 'complete' | 'partial' | 'unavailable';
    protocolHistory: 'complete' | 'partial' | 'unavailable';
  };
  updatedAt: string;
  lagBlocksAtomic: string | null;
  degradedReasons: string[];
  release: { sha: string };
}

export type ChainExplorerPayload = Record<string, unknown>;

// --- Chain dashboard, mining, fees, and chart views ---
// Mirrors backend-apis src/universe-explorer/contracts/chain-dashboard.ts.
// Quantities are exact decimal strings; unknown facts are null, never zero.

export type PoolAttributionEvidence =
  | 'coinbase-tag'
  | 'payout-address'
  | 'auxpow-parent-tag';

export interface BlockMinerView {
  poolId: string | null;
  name: string | null;
  evidence: PoolAttributionEvidence | null;
}

export interface ChainBlockSummary {
  heightAtomic: string;
  hash: string;
  time: string;
  txCountAtomic: string;
  sizeBytesAtomic: string | null;
  feesAtomic: string | null;
  subsidyAtomic: string | null;
  rewardAtomic: string | null;
  medianFeeRateDecimal: string | null;
  difficultyDecimal: string | null;
  intervalSecondsAtomic: string | null;
  miner: BlockMinerView;
}

export interface RecentBlocksView {
  schemaVersion: string;
  chain: ExplorerChain;
  network: ExplorerNetwork;
  tip: SourceCheckpoint | null;
  blocks: ChainBlockSummary[];
  coverage: {
    fromHeightAtomic: string | null;
    toHeightAtomic: string | null;
    complete: boolean;
  };
  observedAt: string;
}

export type FeeRecommendationBasis =
  | 'node-estimate'
  | 'mempool-quantile'
  | 'recent-blocks'
  | 'relay-floor'
  | 'zip317-conventional';

export interface FeeRecommendationLevel {
  id: string;
  amountDecimal: string;
  basis: FeeRecommendationBasis;
}

export type FeeRecommendationsView =
  | {
      schemaVersion: string;
      chain: ExplorerChain;
      network: ExplorerNetwork;
      kind: 'fee-per-kilobyte';
      unit: 'koinu/kB';
      levels: FeeRecommendationLevel[];
      minRelayFeeAtomicPerKb: string;
      tip: SourceCheckpoint | null;
      observedAt: string;
    }
  | {
      schemaVersion: string;
      chain: ExplorerChain;
      network: ExplorerNetwork;
      kind: 'zip-317';
      unit: 'zatoshi';
      marginalFeeAtomic: string;
      graceActionsAtomic: string;
      typicalConventionalFeeAtomic: string;
      paidShareDecimal: string | null;
      basis: FeeRecommendationBasis;
      tip: SourceCheckpoint | null;
      observedAt: string;
    };

export type HashrateUnit = 'hashes-per-second' | 'solutions-per-second';

export interface MiningSummaryView {
  schemaVersion: string;
  chain: ExplorerChain;
  network: ExplorerNetwork;
  tip: SourceCheckpoint | null;
  difficultyDecimal: string | null;
  networkRateDecimal: string | null;
  hashrateUnit: HashrateUnit;
  algorithm: string;
  targetBlockSecondsAtomic: string;
  observedIntervalSecondsDecimal: string | null;
  windowBlocksAtomic: string | null;
  subsidyAtomic: string | null;
  meanRewardAtomic: string | null;
  meanFeesAtomic: string | null;
  /**
   * Blocks in the window that stated a reward, and that stated fees.
   *
   * These are the denominators of the two means, and they are not the window:
   * a block whose reward cannot be derived from public data is left out of the
   * mean rather than counted as zero. Optional because an overlay released
   * before they existed sends neither, and the page has to stay correct
   * against one that does.
   */
  rewardBlocksAtomic?: string | null;
  feeBlocksAtomic?: string | null;
  mergedMining: {
    supported: boolean;
    noticeId: string | null;
  };
  observedAt: string;
}

export interface MiningPoolShare {
  poolId: string;
  name: string;
  blocksAtomic: string;
  shareDecimal: string;
  evidence: PoolAttributionEvidence[];
}

export interface MiningPoolsView {
  schemaVersion: string;
  chain: ExplorerChain;
  network: ExplorerNetwork;
  windowId: string;
  windowBlocksAtomic: string;
  pools: MiningPoolShare[];
  attributionDatasetVersion: string;
  coverageComplete: boolean;
  observedAt: string;
}

export interface ChartSeriesLine {
  key: string;
  unit: string;
  points: [string, string | null][];
}

export interface ChartSeriesView {
  schemaVersion: string;
  chain: ExplorerChain;
  network: ExplorerNetwork;
  seriesId: string;
  rangeId: string;
  lines: ChartSeriesLine[];
  aggregation: string;
  bucketSecondsAtomic: string | null;
  coverage: {
    fromAtomic: string | null;
    toAtomic: string | null;
    complete: boolean;
    earliestAtomic: string | null;
  };
  sourceHeightAtomic: string | null;
  observedAt: string;
}

export interface ChainMempoolSummary {
  txCountAtomic: string | null;
  totalSizeBytesAtomic: string | null;
  totalFeesAtomic: string | null;
  arrivalRatePerSecondDecimal: string | null;
  observedAt: string | null;
}

export type ChainSubsystemId =
  | 'core-node'
  | 'confirmed-history'
  | 'address-history'
  | 'mempool'
  | 'mining-analytics'
  | 'historical-statistics'
  | 'protocol-indexers';

export interface ChainSubsystemHealth {
  id: ChainSubsystemId;
  state: 'ready' | 'degraded' | 'unavailable';
  reasonIds: string[];
}

export interface ChainDashboardView {
  schemaVersion: string;
  chain: ExplorerChain;
  network: ExplorerNetwork;
  tip: SourceCheckpoint | null;
  recentBlocks: RecentBlocksView | null;
  buckets: ChainExplorerPayload | null;
  fees: FeeRecommendationsView | null;
  mempool: ChainMempoolSummary | null;
  mining: MiningSummaryView | null;
  subsystems: ChainSubsystemHealth[];
  observedAt: string;
}

export interface UniverseSearchResult {
  chain: ExplorerChain;
  network: 'mainnet';
  kind: string;
  reference: string;
  label: string;
  path: string;
  exact: boolean;
  proof: { authority: string; state: 'proved' };
}

export interface UniverseSearchResponse {
  schemaVersion: 'universe-search-v1';
  query: string;
  activeChain: ExplorerChain;
  scope: 'active' | 'all';
  groups: Array<{
    chain: ExplorerChain;
    network: 'mainnet';
    results: UniverseSearchResult[];
  }>;
  failures: Array<{
    chain: ExplorerChain;
    code: 'deadline' | 'unavailable';
  }>;
  privacy: {
    zcash: string;
  };
}

/**
 * One protocol's recent activity, read from that protocol's own first-party
 * authority by the explorer backend. The authority's records travel through
 * verbatim: quantities are the decimal strings the authority issued, and a
 * field this build has no reading for is kept rather than dropped.
 */
export interface ExplorerProtocolActivityPage {
  schemaVersion: 'universe-protocol-activity-v1';
  protocolId: string;
  state: 'served' | 'unconfigured' | 'unavailable' | 'unsupported';
  authorityId: string | null;
  feedPath: string | null;
  source: {
    id: string | null;
    protocol: string | null;
    chain: string | null;
    network: string | null;
    coverage: string | null;
    cursor: string | null;
    asOf: string | null;
  } | null;
  assets: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  invalidations: Array<Record<string, unknown>>;
  holderSnapshots: Array<Record<string, unknown>>;
  nextCursor: string | null;
  hasMore: boolean;
  checkpoint: {
    heightAtomic: string;
    blockHash: string;
    observedAt: string;
  } | null;
  degradedReason: string | null;
  observedAt: string;
}

export type {
  AnimaSupply,
  AnimaStatusDocument,
  AnimaLoggedEvent,
  AnimaEventsDocument,
  AnimaEventDocument,
  AnimaWaymark,
  AnimaAchievement,
  AnimaOrganism,
  AnimaOrganismsDocument,
  AnimaOrganismDocument,
  AnimaOrganismHistoryDocument,
} from './anima.types';

/**
 * One protocol's standing objects, read from that protocol's own
 * first-party authority. The records travel through verbatim; quantities
 * stay the decimal strings the authority issued.
 */
export interface ExplorerProtocolObjectsPage {
  schemaVersion: 'universe-protocol-objects-v1';
  protocolId: string;
  state: 'served' | 'unconfigured' | 'unavailable' | 'unsupported';
  authorityId: string | null;
  objectsPath: string | null;
  items: Array<Record<string, unknown>>;
  nextCursor: string | null;
  checkpoint: {
    heightAtomic: string;
    blockHash: string;
    observedAt: string;
  } | null;
  degradedReason: string | null;
  observedAt: string;
}

// ---------------------------------------------------------------------------
// Product Verticals Type Declarations
// ---------------------------------------------------------------------------

export interface FractalBlockSummary {
  readonly hash: string;
  readonly height: number;
  readonly time: number;
  readonly txCount: number;
  readonly size: number;
  readonly weight: number;
  readonly merkleRoot: string;
  readonly difficulty: number;
  readonly miner?: string;
}

export interface FractalTransactionView {
  readonly txid: string;
  readonly hash: string;
  readonly version: number;
  readonly size: number;
  readonly weight: number;
  readonly locktime: number;
  readonly vin: readonly any[];
  readonly vout: readonly any[];
  readonly blockHash?: string;
  readonly blockHeight?: number;
  readonly blockTime?: number;
  readonly feeAtomic: string;
  readonly cat20Operations?: readonly Cat20Operation[];
}

export interface Cat20Token {
  readonly tokenId: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly maxSupplyAtomic: string;
  readonly circulatingSupplyAtomic: string;
  readonly mintLimitAtomic: string;
  readonly deployTxid: string;
  readonly deployHeight: number;
  readonly minterAddress: string;
  readonly minterType: 'open' | 'closed' | 'covenant';
  readonly holderCount: number;
  readonly transferCount: number;
  readonly state: 'active' | 'minting' | 'capped';
}

export interface Cat20Holder {
  readonly address: string;
  readonly balanceAtomic: string;
  readonly percentage: string;
}

export interface Cat20Operation {
  readonly type: 'deploy' | 'mint' | 'transfer' | 'burn';
  readonly tokenId: string;
  readonly amountAtomic: string;
  readonly fromAddress?: string;
  readonly toAddress?: string;
  readonly valid: boolean;
  readonly invalidReason?: string;
}

export interface FractalMempoolOverview {
  readonly count: number;
  readonly totalBytes: number;
  readonly totalWeight: number;
  readonly minFeeRate: number;
  readonly maxFeeRate: number;
  readonly medianFeeRate: number;
  readonly pendingCat20TxCount: number;
}

export interface ZcashValuePool {
  readonly id: 'transparent' | 'sprout' | 'sapling' | 'orchard' | 'lockbox';
  readonly name: string;
  readonly balanceZat: string;
  readonly balanceZec: string;
  readonly percentageOfSupply: string;
  readonly txCount: number;
  readonly description: string;
  readonly shielded: boolean;
  readonly deprecationStatus: 'active' | 'retiring' | 'deprecated';
}

export interface ZcashPoolFlow {
  readonly height: number;
  readonly blockHash: string;
  readonly timestamp: number;
  readonly pool: string;
  readonly inflowZat: string;
  readonly outflowZat: string;
  readonly netChangeZat: string;
  readonly transactionCount: number;
}

export interface ZcashNetworkUpgrade {
  readonly name: string;
  readonly activationHeight: number;
  readonly branchId: string;
  readonly activatedAt: string;
  readonly features: readonly string[];
}

export interface ZcashPrivacySummary {
  readonly tipHeight: number;
  readonly totalCirculatingSupplyZat: string;
  readonly totalShieldedSupplyZat: string;
  readonly shieldedPercentage: string;
  readonly pools: readonly ZcashValuePool[];
  readonly recentFlows: readonly ZcashPoolFlow[];
  readonly upgrades: readonly ZcashNetworkUpgrade[];
}

export interface LiquidAssetRecord {
  readonly assetId: string;
  readonly name: string;
  readonly ticker: string;
  readonly precision: number;
  readonly issuanceTxid: string;
  readonly issuanceVin: number;
  readonly reissuanceToken?: string;
  readonly isConfidential: boolean;
  readonly circulatingAmount?: string;
  readonly issuerPubkey?: string;
  readonly hasProof: boolean;
}

export interface LiquidPegRecord {
  readonly id: string;
  readonly type: 'peg-in' | 'peg-out';
  readonly bitcoinTxid: string;
  readonly bitcoinVout?: number;
  readonly liquidTxid: string;
  readonly liquidVout?: number;
  readonly amountSats: string;
  readonly status: 'initiated' | 'confirmed' | 'finalized' | 'reorged';
  readonly confirmations: number;
  readonly timestamp: number;
  readonly federationWitnessAddress: string;
}

export interface LiquidFederationEpoch {
  readonly epochNumber: number;
  readonly signblockscript: string;
  readonly activeSigners: number;
  readonly totalSigners: number;
  readonly threshold: number;
  readonly startHeight: number;
  readonly endHeight?: number;
  readonly blockSignerCounts: Record<string, number>;
}

export interface LiquidObservatorySummary {
  readonly blockHeight: number;
  readonly blockHash: string;
  readonly dynamicFederation: {
    readonly currentEpoch: number;
    readonly signersOnline: number;
    readonly totalSigners: number;
    readonly blockSigningThreshold: string;
  };
  readonly peggedReserveSats: string;
  readonly activeAssetCount: number;
  readonly confidentialTxPercentage: string;
  readonly recentPegs: readonly LiquidPegRecord[];
}

export interface DatasetManifest {
  readonly id: string;
  readonly name: string;
  readonly category: 'blockchain' | 'mempool' | 'protocols' | 'network';
  readonly description: string;
  readonly updateFrequency: 'realtime' | 'per-block' | 'hourly' | 'daily';
  readonly rowCountEstimate: string;
  readonly sizeEstimateBytes: string;
  readonly supportedFormats: readonly ('parquet' | 'ndjson' | 'csv' | 'json')[];
  readonly fields: readonly { readonly name: string; readonly type: string; readonly description: string; readonly primaryKey?: boolean }[];
}

export interface StreamManifest {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string;
  readonly transport: 'sse' | 'websocket';
  readonly description: string;
  readonly schemaRef: string;
  readonly messageRatePerSec: number;
}

export interface QueryResult {
  readonly datasetId: string;
  readonly rowCount: number;
  readonly totalAvailable: number;
  readonly executionTimeMs: number;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

export interface McpToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly sampleCall: string;
}

export interface ObserverNode {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly clientVersion: string;
  readonly protocolVersion: number;
  readonly fullRbf: boolean;
  readonly minRelayFeeRate: number;
  readonly clockOffsetMs: number;
  readonly connectedPeers: number;
  readonly mempoolTxCount: number;
  readonly status: 'online' | 'syncing' | 'degraded';
}

export interface PropagationObservation {
  readonly txid: string;
  readonly firstSeenTimestamp: number;
  readonly nodeObservations: readonly { readonly nodeId: string; readonly nodeName: string; readonly arrivedAt: number; readonly deltaFromFirstMs: number; readonly accepted: boolean }[];
  readonly medianLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly spreadDeltaMs: number;
}

export interface BlockTemplateComparison {
  readonly blockHeight: number;
  readonly generatedAt: number;
  readonly candidateTemplates: readonly { readonly poolName: string; readonly txCount: number; readonly totalWeight: number; readonly totalFeesSats: string; readonly expectedMedianFeeRate: number }[];
  readonly consensusMempoolTxCount: number;
  readonly missingFromLocalCount: number;
  readonly feeRateSpreadSatVb: number;
}

export interface TaprootAssetItem {
  readonly assetId: string;
  readonly assetType: 'normal' | 'collectible';
  readonly name: string;
  readonly groupKey?: string;
  readonly genesisPoint: string;
  readonly genesisHeight: number;
  readonly totalAmountAtomic: string;
  readonly anchorTxid: string;
  readonly anchorOutpoint: string;
  readonly scriptKey: string;
  readonly hasProofFile: boolean;
  readonly mintTime: number;
}

export interface TaprootAssetGroup {
  readonly groupKey: string;
  readonly name: string;
  readonly totalAssetsCount: number;
  readonly totalCirculatingSupplyAtomic: string;
}

export interface Bolt12Offer {
  readonly offerId: string;
  readonly offerString: string;
  readonly description: string;
  readonly issuer?: string;
  readonly amountMsat?: string;
  readonly currency?: string;
  readonly blindRoutesCount: number;
  readonly valid: boolean;
  readonly expiry?: number;
}

export interface LightningRfqQuote {
  readonly quoteId: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly askRate: string;
  readonly bidRate: string;
  readonly spreadBps: number;
  readonly validUntil: number;
}

export interface ArkOperator {
  readonly id: string;
  readonly name: string;
  readonly aspPubkey: string;
  readonly roundIntervalSec: number;
  readonly currentBatchHeight: number;
  readonly activeVtxoCount: number;
  readonly totalVolumeSats: string;
  readonly status: 'online' | 'degraded';
}

export interface ArkBatch {
  readonly batchId: string;
  readonly operatorId: string;
  readonly anchorTxid: string;
  readonly rootHash: string;
  readonly vtxoCount: number;
  readonly totalAmountSats: string;
  readonly roundTimestamp: number;
  readonly expirationTimestamp: number;
  readonly status: 'settled' | 'provisional' | 'swept';
}

export interface ArkVtxo {
  readonly vtxoId: string;
  readonly batchId: string;
  readonly amountSats: string;
  readonly userPubkey: string;
  readonly aspPubkey: string;
  readonly timelockExpiryBlocks: number;
  readonly treeDepth: number;
  readonly treeIndex: number;
  readonly status: 'spendable' | 'settled' | 'exiting' | 'expired';
  readonly exitTxid?: string;
}

export interface StratumV2RoleStatus {
  readonly role: 'mining-proxy' | 'job-declarator' | 'template-provider' | 'pool';
  readonly name: string;
  readonly endpoint: string;
  readonly noiseProtocolSecured: boolean;
  readonly negotiatedSubprotocols: readonly string[];
  readonly connectedDownstreams: number;
  readonly uptimeSec: number;
  readonly status: 'active' | 'degraded';
}

export interface StratumV2Template {
  readonly templateId: string;
  readonly blockHeight: number;
  readonly coinbaseTxValueSats: string;
  readonly declaredTxCount: number;
  readonly poolSelectedTxCount: number;
  readonly feeRateDeltaSatVb: number;
  readonly totalWeight: number;
  readonly status: 'mining' | 'superseded' | 'won';
  readonly generatedAt: number;
}

export interface StratumV2JobDeclaration {
  readonly jobId: string;
  readonly templateId: string;
  readonly declaratorId: string;
  readonly minerDeclaredTxids: readonly string[];
  readonly poolModifiedTxids: readonly string[];
  readonly acceptedByPool: boolean;
  readonly poolRejectionCode?: string;
  readonly latencyMs: number;
}

export interface L2BridgeSystem {
  readonly id: string;
  readonly name: string;
  readonly architecture: 'bitvm2' | 'clementine-bitvm' | 'zk-rollup-bridge' | 'sidechain-peg';
  readonly trustModel: '1-of-n' | 'multisig-federated' | 'committee-attested';
  readonly bridgeContractAddress: string;
  readonly lockedBtcSats: string;
  readonly operatorCount: number;
  readonly challengePeriodBlocks: number;
  readonly activeChallengesCount: number;
  readonly status: 'live' | 'testing' | 'halted';
  readonly description: string;
}

export interface L2Challenge {
  readonly challengeId: string;
  readonly systemId: string;
  readonly assertionTxid: string;
  readonly challengeTxid: string;
  readonly assertBlockHeight: number;
  readonly challengerAddress: string;
  readonly bondAmountSats: string;
  readonly status: 'pending_response' | 'disproved' | 'confirmed_honest' | 'slashed';
  readonly timeoutBlockHeight: number;
}

export interface L2ReserveAudit {
  readonly systemId: string;
  readonly totalLockedReserveSats: string;
  readonly reportedL2SupplySats: string;
  readonly reserveRatio: string;
  readonly lastAuditHeight: number;
  readonly reserveOutpoints: readonly { readonly outpoint: string; readonly valueSats: string }[];
}

export interface UtxoCheckpoint {
  readonly blockHeight: number;
  readonly blockHash: string;
  readonly muhashHex: string;
  readonly totalTxOuts: number;
  readonly bogoSize: string;
  readonly totalAmountSats: string;
  readonly verifiedAtTimestamp: number;
}

export interface SupplyCohort {
  readonly label: string;
  readonly txOutCount: number;
  readonly totalAmountSats: string;
  readonly supplyPercentage: string;
}

export interface ScriptTypeDistribution {
  readonly scriptType: 'p2pk' | 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr' | 'other';
  readonly count: number;
  readonly totalAmountSats: string;
  readonly percentage: string;
}

export interface ProtocolBearingUtxos {
  readonly ordinalsBearingCount: number;
  readonly runesBearingCount: number;
  readonly stampsBearingCount: number;
  readonly multiProtocolCount: number;
  readonly pureBitcoinCount: number;
}

export interface UtreexoRootsView {
  readonly blockHeight: number;
  readonly numLeaves: number;
  readonly roots: readonly string[];
  readonly forestRows: number;
}

export interface WildkinCreature {
  readonly creatureId: string;
  readonly inscriptionId: string;
  readonly inscriptionNumber: number;
  readonly name: string;
  readonly generation: number;
  readonly bindingUtxo: string;
  readonly ownerAddress: string;
  readonly parentAId?: string;
  readonly parentBId?: string;
  readonly genomeHex: string;
  readonly formatTag: 'wk';
  readonly rulesetVersion: number;
  readonly hasBraided: boolean;
  readonly status: 'active' | 'transferred' | 'braided';
  readonly birthBlockHeight: number;
  readonly birthTimestamp: number;
}

export interface WildkinBraidCeremony {
  readonly braidTxid: string;
  readonly heirCreatureId: string;
  readonly parentAId: string;
  readonly parentBId: string;
  readonly inheritanceManifestHash: string;
  readonly relationshipAttestationHash: string;
  readonly blockHeight: number;
  readonly timestamp: number;
  readonly confirmations: number;
  readonly valid: boolean;
}

export interface WildkinStatusSummary {
  readonly ruleset: string;
  readonly activationStatus: 'draft' | 'active';
  readonly totalCreaturesCount: number;
  readonly totalBraidsCount: number;
  readonly maxAncestryDepth: number;
  readonly latestCreatures: readonly WildkinCreature[];
}

