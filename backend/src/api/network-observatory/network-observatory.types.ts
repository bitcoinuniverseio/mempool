/**
 * Types for the Cross-Node Mempool, Relay, Policy, and Block-Template Observatory.
 *
 * Every read carries the identity of the observer that produced it and the
 * time it was produced. This deployment has one observer: this backend's
 * own mempool poll and its owned Core node. Dimensions a single local
 * observer cannot measure (regions, clock offsets, inter-node latency,
 * per-pool templates) are `null` or 'unknown', never estimated.
 */

/** Who observed, and how far its clock can be trusted. */
export interface ObserverIdentity {
  readonly observerId: string;
  readonly observers: 1;
  readonly clockOffsetMs: number | null;
  readonly clockUncertaintyMs: number | null;
  readonly method: string;
}

/** Freshness and bound of what is retained. */
export interface ObservationWindow {
  readonly observedAtUtc: string;
  readonly ageMs: number;
  readonly freshnessLimitMs: number;
  readonly retentionMs: number;
  readonly retainedTransactions: number;
  readonly lastPollUtc: string | null;
  readonly lastCompletePollUtc: string | null;
  readonly collection: 'not_started' | 'observing' | 'interrupted' | 'stale';
}

export interface ObserverNode {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly clientVersion: string;
  readonly protocolVersion: number | null;
  readonly fullRbf: boolean | null;
  readonly minRelayFeeRate: number | null;
  readonly clockOffsetMs: number | null;
  readonly connectedPeers: number;
  readonly mempoolTxCount: number | null;
  readonly status: 'online' | 'syncing' | 'degraded';
  readonly network: string;
  readonly observedAtUtc: string;
  readonly policySourceAvailable: boolean;
  readonly scope: string;
}

export interface PropagationObservation {
  readonly txid: string | null;
  readonly network: string;
  readonly state: 'observed' | 'not-observed' | 'no-observations';
  readonly firstSeenTimestamp: number | null;
  readonly lastSeenTimestamp: number | null;
  readonly nodeObservations: readonly NodeArrival[];
  readonly medianLatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly spreadDeltaMs: number | null;
  readonly observer: ObserverIdentity;
  readonly window: ObservationWindow;
  readonly expiresAtUtc: string | null;
  readonly scope: string;
}

export interface NodeArrival {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly arrivedAt: number;
  readonly deltaFromFirstMs: number;
  readonly accepted: boolean;
  readonly rejectionReason?: string;
  readonly presence: 'present' | 'left_mempool';
  readonly completePoll: boolean;
  readonly previousCompletePollUtc: string | null;
}

export interface BlockTemplateComparison {
  readonly network: string;
  readonly state: 'observed' | 'no-templates-observed';
  readonly blockHeight: number | null;
  readonly generatedAt: number | null;
  readonly candidateTemplates: readonly CandidateTemplate[];
  readonly consensusMempoolTxCount: number | null;
  readonly missingFromLocalCount: number | null;
  readonly feeRateSpreadSatVb: number | null;
  readonly sources: readonly TemplateSourceStatus[];
  readonly observer: ObserverIdentity;
  readonly retention: { readonly templates: number; readonly txidsPerTemplate: number };
  readonly scope: string;
}

export interface TemplateSourceStatus {
  readonly sourceId: string;
  readonly name: string;
  readonly status: 'active' | 'degraded' | 'offline' | 'not_collected';
  readonly lastTemplateAt: string | null;
  readonly lastError: string | null;
}

export interface CandidateTemplate {
  readonly poolName: string;
  readonly templateId: string;
  readonly sourceId: string;
  readonly sourceType: 'core_gbt' | 'mempool_projection';
  readonly observedAtUtc: string;
  readonly prevBlockHash: string;
  readonly txCount: number;
  readonly totalWeight: number;
  readonly totalFeesSats: string;
  readonly expectedMedianFeeRate: number | null;
  readonly uniqueTxids: readonly string[];
  readonly missingFromLocalMempool: number | null;
}
