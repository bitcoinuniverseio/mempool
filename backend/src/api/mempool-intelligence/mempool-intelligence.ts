import { MempoolTransactionExtended } from '../../mempool.interfaces';
import {
  buildClusterFor,
  buildClusters,
  feerateDiagram,
  mergeChunks,
  type ClusterInputTx,
  type ClusterView,
  type DiagramPoint,
} from './cluster-engine';

/**
 * Turns this process's in memory mempool into clusters, chunks and a fee rate
 * diagram.
 *
 * The mempool is already held here, kept current by the same loop that feeds
 * the projected blocks, so nothing in this file asks Bitcoin Core for anything.
 * That is deliberate: the RPC budget is shared across every Universe protocol,
 * and a page that recomputed clusters from `getrawmempool` on each request
 * would take a share of it away from indexers that have no alternative source.
 *
 * The one thing it does cache is the built view, because linearizing the whole
 * mempool is the expensive part and the mempool itself only changes when the
 * poll loop says so. The cache carries the exact age of what it holds, so a
 * reader is told how old the answer is instead of being left to assume it is
 * live.
 */

/** How long a built view may be reused before it is rebuilt. */
export const FRESHNESS_BUDGET_MS = 5000;

export interface ClusterFreshness {
  /** When the underlying mempool snapshot was linearized. */
  readonly builtAt: string;
  /** Age of that snapshot in milliseconds at the time of the answer. */
  readonly ageMs: number;
  /** The budget past which the view is rebuilt rather than reused. */
  readonly budgetMs: number;
  /** True while the answer is inside its budget. */
  readonly withinBudget: boolean;
  /** Transactions the snapshot was built from. */
  readonly mempoolSize: number;
}

export interface ClusterSummary {
  readonly id: string;
  readonly txCount: number;
  readonly chunkCount: number;
  readonly feeSats: number;
  readonly vsize: number;
  readonly weight: number;
  /** Fee rate of the cluster's first chunk, the best a miner can do here. */
  readonly topFeerate: number;
}

export interface ClusterListResult {
  readonly clusters: readonly ClusterSummary[];
  /** Clusters in the mempool, which may exceed the page returned. */
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly freshness: ClusterFreshness;
}

export interface DiagramResult {
  readonly points: readonly DiagramPoint[];
  /**
   * The same cumulative curve built by ordering transactions on their own fee
   * rate rather than by chunk. Comparing the two is what shows a reader why
   * per transaction fee rate is the wrong thing to sort a block by.
   */
  readonly naivePoints: readonly DiagramPoint[];
  readonly chunkCount: number;
  readonly totalVsize: number;
  readonly totalFeeSats: number;
  readonly freshness: ClusterFreshness;
}

interface BuiltView {
  readonly clusters: ClusterView[];
  readonly byTxid: Map<string, ClusterView>;
  readonly builtAt: number;
  readonly mempoolSize: number;
  readonly inputs: ClusterInputTx[];
}

/**
 * The size a miner charges for a transaction.
 *
 * `adjustedVsize` is the sigop adjusted size the block assembler actually uses,
 * so a transaction that is cheap in bytes but expensive in signature operations
 * is charged for what it really costs. It is only set once the transaction has
 * been through that adjustment, so plain `vsize` is the fallback rather than a
 * default.
 */
function miningVsize(tx: MempoolTransactionExtended): number {
  const adjusted = tx.adjustedVsize;
  if (typeof adjusted === 'number' && Number.isFinite(adjusted) && adjusted > 0) {
    return Math.round(adjusted);
  }
  return Math.round(tx.vsize);
}

/**
 * Reduces the mempool to the shape the linearizer needs.
 *
 * A parent only counts when it is itself unconfirmed and present here. An
 * input that spends a confirmed output is not a cluster edge, and one that
 * names a transaction this process has not seen is not evidence of anything.
 */
export function toClusterInputs(
  mempool: { [txid: string]: MempoolTransactionExtended },
): ClusterInputTx[] {
  const present = new Set(Object.keys(mempool));
  const inputs: ClusterInputTx[] = [];
  for (const txid of present) {
    const tx = mempool[txid];
    if (!tx) { continue; }
    const parents: string[] = [];
    const seen = new Set<string>();
    for (const vin of tx.vin ?? []) {
      const parent = vin?.txid;
      if (!parent || parent === txid || seen.has(parent) || !present.has(parent)) {
        continue;
      }
      seen.add(parent);
      parents.push(parent);
    }
    inputs.push({
      txid,
      vsize: miningVsize(tx),
      weight: Math.round(tx.weight),
      fee: Math.round(tx.fee),
      parents,
    });
  }
  // Sorting here rather than relying on object key order means the same
  // mempool always produces the same input list, which is what lets the
  // linearization be compared run to run.
  inputs.sort((a, b) => (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0));
  return inputs;
}

class MempoolIntelligence {
  private view: BuiltView | null = null;

  /**
   * Rebuilds the view when the cached one has aged past the budget.
   *
   * `now` is a parameter so tests can advance time without waiting for it.
   */
  private build(
    mempool: { [txid: string]: MempoolTransactionExtended },
    now: number,
  ): BuiltView {
    const cached = this.view;
    if (cached && now - cached.builtAt < FRESHNESS_BUDGET_MS
      && cached.mempoolSize === Object.keys(mempool).length) {
      return cached;
    }
    const inputs = toClusterInputs(mempool);
    const clusters = buildClusters(inputs);
    const byTxid = new Map<string, ClusterView>();
    for (const cluster of clusters) {
      for (const txid of cluster.txids) { byTxid.set(txid, cluster); }
    }
    const built: BuiltView = {
      clusters,
      byTxid,
      builtAt: now,
      mempoolSize: inputs.length,
      inputs,
    };
    this.view = built;
    return built;
  }

  private freshness(view: BuiltView, now: number): ClusterFreshness {
    const ageMs = Math.max(0, now - view.builtAt);
    return {
      builtAt: new Date(view.builtAt).toISOString(),
      ageMs,
      budgetMs: FRESHNESS_BUDGET_MS,
      withinBudget: ageMs < FRESHNESS_BUDGET_MS,
      mempoolSize: view.mempoolSize,
    };
  }

  /** Drops the cached view, so the next read rebuilds from the mempool. */
  public invalidate(): void {
    this.view = null;
  }

  /**
   * Clusters ordered by what a miner would reach first, then paged.
   *
   * Ordering on the first chunk's fee rate puts the clusters that matter for
   * the next block at the front, which is the order a reader of this page
   * cares about. Ties fall back to the cluster id so paging is stable.
   */
  public listClusters(
    mempool: { [txid: string]: MempoolTransactionExtended },
    offset: number,
    limit: number,
    now: number = Date.now(),
  ): ClusterListResult {
    const view = this.build(mempool, now);
    const summaries: ClusterSummary[] = view.clusters.map((cluster) => ({
      id: cluster.id,
      txCount: cluster.txCount,
      chunkCount: cluster.chunks.length,
      feeSats: cluster.feeSats,
      vsize: cluster.vsize,
      weight: cluster.weight,
      topFeerate: cluster.chunks.length ? cluster.chunks[0].feerate : 0,
    }));
    summaries.sort((a, b) => {
      if (a.topFeerate !== b.topFeerate) { return b.topFeerate - a.topFeerate; }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return {
      clusters: summaries.slice(offset, offset + limit),
      total: summaries.length,
      offset,
      limit,
      freshness: this.freshness(view, now),
    };
  }

  /**
   * One cluster in full, addressed either by its id or by any member txid.
   *
   * Accepting a member txid matters because a reader arrives from a
   * transaction page and does not know the cluster id, and a redirect that
   * guessed would be one more thing to get wrong.
   */
  public getCluster(
    mempool: { [txid: string]: MempoolTransactionExtended },
    reference: string,
    now: number = Date.now(),
  ): { cluster: ClusterView; freshness: ClusterFreshness } | null {
    const view = this.build(mempool, now);
    const found = view.byTxid.get(reference)
      ?? view.clusters.find((cluster) => cluster.id === reference)
      ?? null;
    if (!found) { return null; }
    return { cluster: found, freshness: this.freshness(view, now) };
  }

  /**
   * The mempool wide fee rate diagram, alongside the curve a naive
   * per transaction ordering would produce.
   *
   * The naive curve is not concave: sorting a child above its unconfirmed
   * parent produces a sequence no miner could actually build, and drawing it
   * next to the real one is the clearest way to show that.
   */
  public getDiagram(
    mempool: { [txid: string]: MempoolTransactionExtended },
    now: number = Date.now(),
  ): DiagramResult {
    const view = this.build(mempool, now);
    const merged = mergeChunks(view.clusters);
    const points = feerateDiagram(merged.map((entry) => entry.chunk));

    const naiveOrder = [...view.inputs].sort((a, b) => {
      const left = a.fee * b.vsize;
      const right = b.fee * a.vsize;
      if (left !== right) { return right - left; }
      return a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0;
    });
    const naivePoints: DiagramPoint[] = [
      { vsize: 0, feeSats: 0, feerate: null, chunkIndex: null },
    ];
    let naiveVsize = 0;
    let naiveFee = 0;
    naiveOrder.forEach((tx, index) => {
      naiveVsize += tx.vsize;
      naiveFee += tx.fee;
      naivePoints.push({
        vsize: naiveVsize,
        feeSats: naiveFee,
        feerate: tx.vsize > 0 ? tx.fee / tx.vsize : 0,
        chunkIndex: index,
      });
    });

    const last = points[points.length - 1];
    return {
      points,
      naivePoints,
      chunkCount: merged.length,
      totalVsize: last ? last.vsize : 0,
      totalFeeSats: last ? last.feeSats : 0,
      freshness: this.freshness(view, now),
    };
  }

  /**
   * The cluster around one transaction, built from that transaction alone.
   *
   * This is the path a transaction page uses. It goes through the same engine
   * as the list, so the chunk a transaction is reported in is the same chunk
   * the cluster page shows it in.
   */
  public getPackageFor(
    mempool: { [txid: string]: MempoolTransactionExtended },
    txid: string,
    now: number = Date.now(),
  ): { cluster: ClusterView; freshness: ClusterFreshness } | null {
    const view = this.build(mempool, now);
    const cached = view.byTxid.get(txid);
    if (cached) { return { cluster: cached, freshness: this.freshness(view, now) }; }
    const cluster = buildClusterFor(view.inputs, txid);
    if (!cluster) { return null; }
    return { cluster, freshness: this.freshness(view, now) };
  }
}

export default new MempoolIntelligence();
