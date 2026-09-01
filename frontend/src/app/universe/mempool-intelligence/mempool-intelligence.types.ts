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
