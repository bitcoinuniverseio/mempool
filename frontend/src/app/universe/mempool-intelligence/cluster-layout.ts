import { ChunkView, ClusterTxView, ClusterView, DiagramPoint } from './mempool-intelligence.types';

/**
 * Layout for the cluster graph and the fee rate diagram.
 *
 * Kept pure and separate from the components so the geometry can be asserted
 * directly. A graph that silently overlaps two nodes, or a curve that runs off
 * its own viewport, is a rendering bug that no component test would catch as
 * clearly as an assertion about coordinates.
 *
 * Nothing here decides what is true. It only decides where a thing is drawn,
 * and every drawn thing has an equivalent row in the accessible table beside
 * it, so a reader who cannot use the canvas loses no information.
 */

export interface GraphNode {
  readonly txid: string;
  /** Depth from the cluster's roots, which becomes the column. */
  readonly depth: number;
  /** Position within the depth, which becomes the row. */
  readonly lane: number;
  readonly x: number;
  readonly y: number;
  readonly chunkIndex: number;
  readonly tx: ClusterTxView;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** True when parent and child are mined in the same chunk. */
  readonly withinChunk: boolean;
}

export interface GraphLayout {
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
  readonly width: number;
  readonly height: number;
}

export interface LayoutOptions {
  readonly columnGap: number;
  readonly rowGap: number;
  readonly nodeRadius: number;
  readonly padding: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  columnGap: 132,
  rowGap: 72,
  nodeRadius: 20,
  padding: 32,
};

/**
 * Depth of every transaction, measured as the longest path from a root.
 *
 * Longest rather than shortest, because a node drawn one column right of its
 * nearest parent can still end up left of another parent, and an edge that
 * points backwards reads as a dependency that runs the wrong way.
 */
export function computeDepths(cluster: ClusterView): Map<string, number> {
  const byTxid = new Map<string, ClusterTxView>();
  for (const tx of cluster.transactions) { byTxid.set(tx.txid, tx); }
  const depths = new Map<string, number>();

  const resolve = (txid: string, guard: Set<string>): number => {
    const known = depths.get(txid);
    if (known !== undefined) { return known; }
    if (guard.has(txid)) { return 0; }
    guard.add(txid);
    const tx = byTxid.get(txid);
    let depth = 0;
    for (const parent of tx?.parents ?? []) {
      if (!byTxid.has(parent)) { continue; }
      depth = Math.max(depth, resolve(parent, guard) + 1);
    }
    guard.delete(txid);
    depths.set(txid, depth);
    return depth;
  };

  // Walking in linear order means a parent is usually already resolved, and
  // the recursion above covers the cases where it is not.
  for (const tx of cluster.transactions) { resolve(tx.txid, new Set()); }
  return depths;
}

/**
 * Places every transaction on a grid of dependency depth against lane.
 *
 * Within a depth, order follows the linearization rather than the txid, so a
 * reader scanning down a column sees the transactions in the order a miner
 * would take them.
 */
export function layoutCluster(
  cluster: ClusterView,
  options: LayoutOptions = DEFAULT_LAYOUT,
): GraphLayout {
  const depths = computeDepths(cluster);
  const lanes = new Map<number, number>();
  const nodes: GraphNode[] = [];
  const byTxid = new Map<string, GraphNode>();

  for (const tx of cluster.transactions) {
    const depth = depths.get(tx.txid) ?? 0;
    const lane = lanes.get(depth) ?? 0;
    lanes.set(depth, lane + 1);
    const node: GraphNode = {
      txid: tx.txid,
      depth,
      lane,
      x: options.padding + options.nodeRadius + depth * options.columnGap,
      y: options.padding + options.nodeRadius + lane * options.rowGap,
      chunkIndex: tx.chunkIndex,
      tx,
    };
    nodes.push(node);
    byTxid.set(tx.txid, node);
  }

  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    for (const parent of node.tx.parents) {
      const from = byTxid.get(parent);
      if (!from) { continue; }
      edges.push({
        from: parent,
        to: node.txid,
        x1: from.x,
        y1: from.y,
        x2: node.x,
        y2: node.y,
        withinChunk: from.chunkIndex === node.chunkIndex,
      });
    }
  }

  const maxDepth = nodes.length ? Math.max(...nodes.map((n) => n.depth)) : 0;
  const maxLane = nodes.length ? Math.max(...nodes.map((n) => n.lane)) : 0;
  return {
    nodes,
    edges,
    width: options.padding * 2 + options.nodeRadius * 2 + maxDepth * options.columnGap,
    height: options.padding * 2 + options.nodeRadius * 2 + maxLane * options.rowGap,
  };
}

export interface CurvePoint {
  readonly x: number;
  readonly y: number;
  readonly point: DiagramPoint;
}

export interface DiagramLayout {
  readonly real: CurvePoint[];
  readonly naive: CurvePoint[];
  readonly width: number;
  readonly height: number;
  readonly maxVsize: number;
  readonly maxFeeSats: number;
}

/**
 * Scales both curves into one box so they can be compared directly.
 *
 * They share a scale on purpose. Two curves drawn to their own maxima would
 * look alike no matter how far apart their totals were, and the gap between
 * them is the entire point of the picture.
 */
export function layoutDiagram(
  real: readonly DiagramPoint[],
  naive: readonly DiagramPoint[],
  width: number,
  height: number,
  padding = 36,
): DiagramLayout {
  const all = [...real, ...naive];
  const maxVsize = all.reduce((max, p) => Math.max(max, p.vsize), 0);
  const maxFeeSats = all.reduce((max, p) => Math.max(max, p.feeSats), 0);
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);

  const project = (points: readonly DiagramPoint[]): CurvePoint[] =>
    points.map((point) => ({
      // A zero maximum only happens for an empty mempool, where every point is
      // the origin anyway, so the curve collapses to a dot rather than
      // dividing by zero.
      x: padding + (maxVsize > 0 ? (point.vsize / maxVsize) * innerWidth : 0),
      y: height - padding - (maxFeeSats > 0 ? (point.feeSats / maxFeeSats) * innerHeight : 0),
      point,
    }));

  return {
    real: project(real),
    naive: project(naive),
    width,
    height,
    maxVsize,
    maxFeeSats,
  };
}

/** An SVG path through already projected points. */
export function toPath(points: readonly CurvePoint[]): string {
  if (!points.length) { return ''; }
  return points
    .map((p, index) => `${index === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
}

/**
 * How much of the next block a chunk sequence fills, capped at one block.
 *
 * Used to mark where the next block's worth of weight runs out on the
 * diagram. It is a projection from the current mempool, not a promise about
 * the next block, and every caller labels it that way.
 */
export function nextBlockCutoff(
  points: readonly CurvePoint[],
  blockVsize = 1_000_000,
): CurvePoint | null {
  for (const point of points) {
    if (point.point.vsize >= blockVsize) { return point; }
  }
  return null;
}

/** Groups a cluster's transactions by chunk, in linearization order. */
export function chunkRows(cluster: ClusterView): {
  chunk: ChunkView;
  transactions: ClusterTxView[];
}[] {
  const byTxid = new Map<string, ClusterTxView>();
  for (const tx of cluster.transactions) { byTxid.set(tx.txid, tx); }
  return cluster.chunks.map((chunk) => ({
    chunk,
    transactions: chunk.txids
      .map((txid) => byTxid.get(txid))
      .filter((tx): tx is ClusterTxView => !!tx),
  }));
}
