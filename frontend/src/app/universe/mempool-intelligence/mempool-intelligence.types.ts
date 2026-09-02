// The shapes `/api/v1/mempool/*` answers with.
//
// Fees are integer satoshis and sizes are integer virtual bytes, exactly as
// the backend computed them. Fee rates are the one derived number, and they
// are only ever used for display and ordering, never to reconstruct a fee.

export interface ClusterFreshness {
  /** When the mempool snapshot behind this answer was linearized. */
  readonly builtAt: string;
  readonly ageMs: number;
  /** The age past which the backend rebuilds rather than reusing. */
  readonly budgetMs: number;
  readonly withinBudget: boolean;
  readonly mempoolSize: number;
}

export interface ChunkView {
  readonly index: number;
  readonly txids: string[];
  readonly feeSats: number;
  readonly vsize: number;
  readonly feerate: number;
}

export interface ClusterTxView {
  readonly txid: string;
  readonly vsize: number;
  readonly weight: number;
  readonly feeSats: number;
  readonly individualFeerate: number;
  readonly effectiveFeerate: number;
  readonly chunkIndex: number;
  readonly linearIndex: number;
  readonly parents: string[];
  readonly children: string[];
  readonly ancestorCount: number;
  readonly ancestorFeeSats: number;
  readonly ancestorVsize: number;
  readonly descendantCount: number;
  readonly descendantFeeSats: number;
  readonly descendantVsize: number;
}

export interface ClusterView {
  readonly id: string;
  readonly txids: string[];
  readonly transactions: ClusterTxView[];
  readonly chunks: ChunkView[];
  readonly feeSats: number;
  readonly vsize: number;
  readonly weight: number;
  readonly txCount: number;
}

export interface ClusterSummary {
  readonly id: string;
  readonly txCount: number;
  readonly chunkCount: number;
  readonly feeSats: number;
  readonly vsize: number;
  readonly weight: number;
  readonly topFeerate: number;
}

export interface ClusterListResponse {
  readonly clusters: ClusterSummary[];
  /** Clusters in the mempool, which may exceed the page returned. */
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly freshness: ClusterFreshness;
}

export interface ClusterResponse {
  readonly cluster: ClusterView;
  readonly freshness: ClusterFreshness;
}

export interface DiagramPoint {
  readonly vsize: number;
  readonly feeSats: number;
  readonly feerate: number | null;
  readonly chunkIndex: number | null;
}

export interface DiagramResponse {
  readonly points: DiagramPoint[];
  /** The curve a naive per transaction fee rate ordering would draw. */
  readonly naivePoints: DiagramPoint[];
  readonly chunkCount: number;
  readonly totalVsize: number;
  readonly totalFeeSats: number;
  readonly freshness: ClusterFreshness;
}

// The shape `POST /api/v1/mempool/simulate` answers with.
//
// A fee is null when the node reported none and this process could not work
// it out. Null is not zero anywhere in here, and a reader that renders it as
// zero reports a free transaction that does not exist.

export interface PackageTxView {
  readonly txid: string;
  readonly vsize: number;
  readonly weight: number;
  readonly feeSats: number | null;
  readonly feeUnknownReason: string | null;
  readonly individualFeerate: number | null;
  readonly effectiveFeerate: number | null;
  readonly chunkIndex: number | null;
  readonly parents: string[];
  readonly children: string[];
  /** Inputs from neither the package nor the mempool, so confirmed or absent. */
  readonly externalInputs: number;
  readonly mempoolInputs: number;
  readonly allowed: boolean;
  readonly rejectReason: string | null;
  readonly effectiveIncludes: string[];
}

export interface ConflictView {
  readonly outpoint: string;
  readonly candidateTxid: string;
  readonly incumbentTxid: string;
  readonly evictedTxids: string[];
  readonly evictedFeeSats: number;
  readonly evictedVsize: number;
}

export interface ReplacementView {
  readonly conflictCount: number;
  readonly evictedTxids: string[];
  readonly evictedFeeSats: number;
  readonly evictedVsize: number;
  readonly packageFeeSats: number;
  readonly packageVsize: number;
  /** Everything evicted, plus the relay cost of the package's own size. */
  readonly requiredFeeSats: number;
  readonly shortfallSats: number;
  readonly satisfiesFeeRules: boolean;
  readonly incompleteReason: string | null;
}

export interface QueuePosition {
  readonly vsizeAhead: number;
  readonly chunksAhead: number;
  readonly feerate: number;
}

export interface PackageSimulation {
  readonly transactions: PackageTxView[];
  readonly topologicalOrder: string[];
  readonly chunks: ChunkView[];
  readonly accepted: boolean;
  readonly conflicts: ConflictView[];
  readonly replacement: ReplacementView | null;
  readonly queuePosition: QueuePosition | null;
  readonly packageFeeSats: number | null;
  readonly packageVsize: number;
  readonly packageWeight: number;
  readonly connected: boolean;
  readonly cyclic: boolean;
}

// The shape `GET /api/v1/mempool/bump/:txid?targetFeerate=N` answers with.
//
// Each route has an `available` flag and a reason when it is false. A route
// that is closed is closed for a stated reason, never by rendering a zero.

export interface RbfPlan {
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly requiredFeeSats: number;
  readonly additionalFeeSats: number;
  readonly resultingFeerate: number;
  readonly evictedTxids: string[];
  readonly evictedFeeSats: number;
  /** True when the replacement rules, not the target rate, set the price. */
  readonly boundByReplacementRules: boolean;
  readonly largestOutputSats: number | null;
  readonly outputAfterBumpSats: number | null;
  readonly outputWouldBecomeDust: boolean;
}

export interface CpfpPlan {
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly spendOutputIndex: number | null;
  readonly spendValueSats: number | null;
  readonly childVsize: number | null;
  readonly requiredChildFeeSats: number;
  readonly changeSats: number | null;
  readonly changeIsDust: boolean;
  readonly resultingPackageFeerate: number;
}

export interface BumpPlan {
  readonly txid: string;
  readonly currentFeeSats: number;
  readonly currentFeerate: number;
  readonly targetFeerate: number;
  readonly rbf: RbfPlan;
  readonly cpfp: CpfpPlan;
  readonly alreadyAtTarget: boolean;
  /** Every output, because this process reads the base chain only. */
  readonly outputsToCheckForAssets: number[];
}
