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

export interface SourceEntry {
  authorityId: string;
  protocols: string[];
  ready: boolean;
  status: string;
  checkpoint?: string;
  checkedAt: string;
}

export type SourcesResponse = SourceEntry[];

export interface StatusResponse {
  registryVersion: string;
  protocolCount: number;
  sources?: SourceEntry[];
  generatedAt: string;
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

export interface ExplorerOutpointPosition {
  outpoint: string;
  vout: number;
  valueSatsAtomic: string;
  asset: ExplorerAssetRef;
  quantityAtomic?: string;
  satRanges?: unknown[];
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
  inputs: ExplorerOutpointPosition[];
  outputs: ExplorerOutpointPosition[];
  actions: ExplorerAssetAction[];
  sourceEvidence: ExplorerPositionEvidence[];
  complete: boolean;
  unknownAttachmentCount: number;
}

// error-shaped body the overlay can return instead of a flow
export interface UniverseApiError {
  error: string;
  [key: string]: unknown;
}
