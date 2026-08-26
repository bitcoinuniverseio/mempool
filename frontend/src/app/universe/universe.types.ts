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
}

export interface SourcesResponse {
  generatedAt: string;
  sources: SourceEntry[];
}

export interface SourceCounts {
  configured: number;
  ready: number;
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
  canonicalAssetId: string;
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
