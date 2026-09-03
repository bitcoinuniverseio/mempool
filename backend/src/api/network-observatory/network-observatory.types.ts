/**
 * Types for the Cross-Node Mempool, Relay, Policy, and Block-Template Observatory.
 */

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
  readonly nodeObservations: readonly NodeArrival[];
  readonly medianLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly spreadDeltaMs: number;
}

export interface NodeArrival {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly arrivedAt: number;
  readonly deltaFromFirstMs: number;
  readonly accepted: boolean;
  readonly rejectionReason?: string;
}

export interface BlockTemplateComparison {
  readonly blockHeight: number;
  readonly generatedAt: number;
  readonly candidateTemplates: readonly CandidateTemplate[];
  readonly consensusMempoolTxCount: number;
  readonly missingFromLocalCount: number;
  readonly feeRateSpreadSatVb: number;
}

export interface CandidateTemplate {
  readonly poolName: string;
  readonly txCount: number;
  readonly totalWeight: number;
  readonly totalFeesSats: string;
  readonly expectedMedianFeeRate: number;
  readonly uniqueTxids: readonly string[];
}
