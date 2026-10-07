export interface Sv2Software {
  software: string; versionAtomic: string; sourceRevision: string | null; binarySha256: string; configurationSha256: string;
}
export interface Sv2Profile {
  schema: 'universe-sv2-source-profile-v1'; network: 'signet' | 'regtest'; genesisHash: string; blockOneHash: string; signetChallenge: string | null;
  core: Sv2Software;
  roleSources: { roleId: string; software: string; version: string; sourceRevision: string | null; binarySha256: string; configurationSha256: string;
    derivative: null | { baseRevision: string; patchSha256: string; patchedSourceSha256: string; cargoLockSha256: string } }[];
}
export interface Sv2Role {
  roleId: string; health: { status: 'observed' | 'unavailable'; httpStatus: number | null; observedAt: string | null };
  uptimeSecondsAtomic: string | null; connectedDownstreamsAtomic: string | null;
  globalCounters: null | { name: string; valueAtomic: string }[];
  transports: { direction: 'upstream' | 'downstream'; peerRoleId: string | null; protocol: 'SV1' | 'SV2' | 'unknown'; security: 'plaintext' | 'noise' | 'unknown'; evidence: 'configured' | 'observed-negotiated' | 'observed-traffic' | 'unknown'; observedAt: string | null }[];
}
export interface Sv2Link {
  eventId: string; sequenceAtomic: string; observedAt: string; logId: string; logOffsetAtomic: string; rawLineSha256: string;
  requestIdAtomic: string; templateIdAtomic: string; channelIdAtomic: string; jobIdAtomic: string;
  coinbaseValueRemainingSats: string; transactionCountAtomic: string; prevHashLE: string;
  declarationSuccess: { observedAt: string; logOffsetAtomic: string; rawLineSha256: string }; acceptance: 'accepted';
}
export interface Sv2Snapshot {
  schema: 'universe-sv2-native-snapshot-v1'; profile: Sv2Profile; profileSha256: string; sourceEpoch: string; sourceGenerationAtomic: string; observedAt: string;
  core: { genesisHash: string; signetChallenge: string | null; checkpoint: { heightAtomic: string; blockHash: string; headerHex: string }; initialBlockDownload: false; verifiedAt: string };
  roles: Sv2Role[]; links: Sv2Link[];
  retention: { scope: 'bounded-retained-native-links'; maximumLinks: 512; retainedLinksAtomic: string; droppedLinksAtomic: string | null; firstSequenceAtomic: string | null; lastSequenceAtomic: string | null; completeHistory: false; gapReason: string | null };
}
export interface Sv2Acquisition { snapshot: Sv2Snapshot; rawSha256: string; bytes: number; }
export interface Sv2Source { read(signal: AbortSignal): Promise<Sv2Acquisition>; }

export type StratumV2RoleStatus = Sv2Role;
export interface StratumV2Template {
  eventId: string; templateId: string; channelId: string; blockHeight: null;
  coinbaseValueRemainingSats: string; coinbaseTxValueSats: null;
  declaredTxCount: string; poolSelectedTxCount: null; feeRateDeltaSatVb: null; totalWeight: null;
  previousBlockHash: string; status: 'observed-current' | 'unverified-history'; observedAt: string; generatedAt: null;
}
export interface StratumV2JobDeclaration {
  eventId: string; jobId: string; templateId: string; requestId: string; channelId: string;
  minerDeclaredTxids: null; poolModifiedTxids: null; acceptedByPool: true; latencyMs: null;
  declarationObservedAt: string; acceptanceObservedAt: string;
}
export type Sv2Family = 'roles' | 'templates' | 'declarations';
export interface Sv2Query { network?: unknown; limit?: unknown; cursor?: unknown; }
export interface Sv2Page<T> {
  schemaVersion: 'universe-sv2-observatory-v1';
  source: Pick<Sv2Snapshot, 'profile' | 'profileSha256' | 'sourceEpoch' | 'sourceGenerationAtomic' | 'observedAt' | 'core' | 'retention'> & { rawSnapshotSha256: string; latestVerifiedAt: string };
  items: T[]; total: number; totalScope: 'captured-retained-observations'; completeHistory: false; nextCursor: string | null;
}

export interface Sv2ConfiguredSource { profile: Sv2Profile; profileSha256: string; }
