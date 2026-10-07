import { Sv2Role, Sv2Snapshot } from './stratum-v2.native-types';
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
