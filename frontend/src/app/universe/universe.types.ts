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
