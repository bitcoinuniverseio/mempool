/**
 * Cluster and chunk linearization for the mempool.
 *
 * A cluster is a connected component of the mempool dependency graph: the set
 * of unconfirmed transactions reachable from one another through spending
 * relationships, in either direction. Bitcoin Core's cluster mempool reasons
 * about mining in exactly these units, because a transaction can only be mined
 * with its unconfirmed ancestors and its fee can only be helped by its
 * descendants.
 *
 * A chunk is the finer unit inside a cluster: the group of transactions a
 * miner takes together, at one shared effective fee rate. Chunks come out of
 * linearization, and their fee rates are non-increasing along the cluster, so
 * plotting cumulative size against cumulative fee gives the concave fee rate
 * diagram this product renders.
 *
 * Everything here is pure. It takes a plain description of the mempool graph
 * and returns plain structures, so the linearization can be asserted directly
 * against fixtures and against a node's own answers without a running node,
 * a database, or a socket.
 *
 * Fees are integer satoshis and sizes are integer virtual bytes. Fee rates are
 * never compared as floating point: every comparison cross-multiplies, so two
 * chunks whose rates differ only past the limit of a double still order
 * deterministically.
 */

/** One transaction as the linearizer needs to see it. */
export interface ClusterInputTx {
  readonly txid: string;
  /** Virtual size in vbytes, as the node's mining code would charge it. */
  readonly vsize: number;
  readonly weight: number;
  /** Absolute fee in satoshis. */
  readonly fee: number;
  /** Txids of this transaction's parents that are themselves unconfirmed. */
  readonly parents: readonly string[];
}

export interface ChunkView {
  /** Position of this chunk in its cluster's linearization, starting at 0. */
  readonly index: number;
  /** Member txids, in an order where every parent precedes its children. */
  readonly txids: readonly string[];
  readonly feeSats: number;
  readonly vsize: number;
  /** Satoshis per vbyte for the chunk as a whole. */
  readonly feerate: number;
}

export interface ClusterTxView {
  readonly txid: string;
  readonly vsize: number;
  readonly weight: number;
  readonly feeSats: number;
  /** fee / vsize for this transaction alone. */
  readonly individualFeerate: number;
  /** The fee rate of the chunk this transaction is mined in. */
  readonly effectiveFeerate: number;
  readonly chunkIndex: number;
  /** Index in the cluster's full linearization, starting at 0. */
  readonly linearIndex: number;
  readonly parents: readonly string[];
  readonly children: readonly string[];
  readonly ancestorCount: number;
  readonly ancestorFeeSats: number;
  readonly ancestorVsize: number;
  readonly descendantCount: number;
  readonly descendantFeeSats: number;
  readonly descendantVsize: number;
}

export interface ClusterView {
  /**
   * Stable identity for the cluster: the lexicographically smallest member
   * txid. It is derived from membership alone, so the same set of
   * transactions always produces the same addressable id, and a URL keeps
   * meaning as long as the cluster itself does.
   */
  readonly id: string;
  readonly txids: readonly string[];
  readonly transactions: readonly ClusterTxView[];
  readonly chunks: readonly ChunkView[];
  readonly feeSats: number;
  readonly vsize: number;
  readonly weight: number;
  readonly txCount: number;
}

/** One point on the cumulative fee rate diagram. */
export interface DiagramPoint {
  readonly vsize: number;
  readonly feeSats: number;
  /** Fee rate of the chunk that ends at this point, null at the origin. */
  readonly feerate: number | null;
  readonly chunkIndex: number | null;
}

/**
 * Compares two fee rates given as fee and size pairs, without dividing.
 *
 * Returns a positive number when the left rate is higher. Division would lose
 * the distinction between rates that differ in the last bits of a double, and
 * a linearization that reorders under rounding is not reproducible against a
 * node.
 */
export function compareFeerate(
  leftFee: number,
  leftSize: number,
  rightFee: number,
  rightSize: number,
): number {
  const left = leftFee * rightSize;
  const right = rightFee * leftSize;
  if (left > right) { return 1; }
  if (left < right) { return -1; }
  return 0;
}

interface Node {
  readonly tx: ClusterInputTx;
  readonly parents: string[];
  readonly children: string[];
}

/**
 * Looks a node up and refuses to continue when it is missing.
 *
 * Every caller here has already established that the txid is a member, so an
 * absent entry is a defect in this file rather than a condition to paper over.
 * Throwing keeps that defect visible instead of letting undefined leak into a
 * fee total.
 */
function nodeAt(nodes: Map<string, Node>, txid: string): Node {
  const node = nodes.get(txid);
  if (!node) {
    throw new Error('cluster-engine: no node for ' + txid);
  }
  return node;
}

/**
 * Builds the adjacency both ways and drops parent references that point
 * outside the supplied set.
 *
 * A parent that is not in the map is a confirmed transaction or one this
 * process has not seen. Treating it as an edge would invent a member the
 * cluster does not have, so it is discarded rather than guessed at.
 */
function buildNodes(txs: readonly ClusterInputTx[]): Map<string, Node> {
  const nodes = new Map<string, Node>();
  for (const tx of txs) {
    nodes.set(tx.txid, { tx, parents: [], children: [] });
  }
  for (const tx of txs) {
    const node = nodeAt(nodes, tx.txid);
    const seen = new Set<string>();
    for (const parent of tx.parents) {
      if (parent === tx.txid || seen.has(parent) || !nodes.has(parent)) { continue; }
      seen.add(parent);
      node.parents.push(parent);
      nodeAt(nodes, parent).children.push(tx.txid);
    }
  }
  for (const node of nodes.values()) {
    node.parents.sort();
    node.children.sort();
  }
  return nodes;
}

/**
 * Splits the graph into connected components, treating edges as undirected.
 *
 * Membership is what makes a cluster, and a child pulls its parents in just as
 * a parent pulls its children in, so the traversal ignores edge direction.
 */
export function findClusters(txs: readonly ClusterInputTx[]): string[][] {
  const nodes = buildNodes(txs);
  const seen = new Set<string>();
  const clusters: string[][] = [];
  // Iterating the sorted txids rather than the input order keeps the output
  // identical for the same mempool no matter what order it was read in.
  const roots = [...nodes.keys()].sort();
  for (const root of roots) {
    if (seen.has(root)) { continue; }
    const members: string[] = [];
    const stack = [root];
    seen.add(root);
    while (stack.length) {
      const txid = stack.pop();
      if (txid === undefined) { break; }
      members.push(txid);
      const node = nodeAt(nodes, txid);
      for (const next of [...node.parents, ...node.children]) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    members.sort();
    clusters.push(members);
  }
  return clusters;
}

/** Ancestors of `txid` within the supplied node map, excluding itself. */
function ancestorsOf(
  nodes: Map<string, Node>,
  txid: string,
  limit: Set<string> | null,
): Set<string> {
  const found = new Set<string>();
  const stack = [...nodeAt(nodes, txid).parents];
  while (stack.length) {
    const next = stack.pop();
    if (next === undefined) { break; }
    if (found.has(next)) { continue; }
    if (limit && !limit.has(next)) { continue; }
    found.add(next);
    stack.push(...nodeAt(nodes, next).parents);
  }
  return found;
}

/** Descendants of `txid` within the supplied node map, excluding itself. */
function descendantsOf(nodes: Map<string, Node>, txid: string): Set<string> {
  const found = new Set<string>();
  const stack = [...nodeAt(nodes, txid).children];
  while (stack.length) {
    const next = stack.pop();
    if (next === undefined) { break; }
    if (found.has(next)) { continue; }
    found.add(next);
    stack.push(...nodeAt(nodes, next).children);
  }
  return found;
}

/**
 * Orders a set so that every parent comes before every child.
 *
 * Ties break on txid, so a chunk with several independent members has one
 * order rather than whichever the hash iteration happened to produce.
 */
function topologicalOrder(nodes: Map<string, Node>, members: Set<string>): string[] {
  const remaining = new Set(members);
  const out: string[] = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter((txid) => nodeAt(nodes, txid).parents.every((p) => !remaining.has(p)))
      .sort();
    if (!ready.length) {
      // A cycle cannot occur in a valid mempool, since a transaction's inputs
      // name transactions that already exist. Emitting the rest in txid order
      // keeps a malformed input from hanging the process.
      out.push(...[...remaining].sort());
      break;
    }
    for (const txid of ready) {
      out.push(txid);
      remaining.delete(txid);
    }
  }
  return out;
}

/**
 * Linearizes one cluster into chunks by repeatedly taking the remaining
 * ancestor set with the highest fee rate.
 *
 * This is the ancestor set algorithm a Bitcoin Core node's mining code has
 * always used to choose what to include, so a chunk here is the group the node
 * would take together, and the resulting chunk fee rates are non-increasing.
 * That property is what makes the fee rate diagram concave, and it is asserted
 * in the tests rather than assumed.
 *
 * Ties are broken by smaller size and then by smallest txid, so the same
 * cluster always linearizes the same way.
 */
function linearize(nodes: Map<string, Node>, members: readonly string[]): ChunkView[] {
  const remaining = new Set(members);
  const chunks: ChunkView[] = [];
  while (remaining.size) {
    let bestSet: Set<string> | null = null;
    let bestFee = 0;
    let bestSize = 0;
    let bestTxid = '';
    for (const txid of [...remaining].sort()) {
      const set = ancestorsOf(nodes, txid, remaining);
      set.add(txid);
      let fee = 0;
      let size = 0;
      for (const member of set) {
        fee += nodeAt(nodes, member).tx.fee;
        size += nodeAt(nodes, member).tx.vsize;
      }
      if (size <= 0) { continue; }
      if (bestSet === null) {
        bestSet = set; bestFee = fee; bestSize = size; bestTxid = txid;
        continue;
      }
      const order = compareFeerate(fee, size, bestFee, bestSize);
      const better = order > 0
        || (order === 0 && size < bestSize)
        || (order === 0 && size === bestSize && txid < bestTxid);
      if (better) {
        bestSet = set; bestFee = fee; bestSize = size; bestTxid = txid;
      }
    }
    if (bestSet === null) { break; }
    chunks.push({
      index: chunks.length,
      txids: topologicalOrder(nodes, bestSet),
      feeSats: bestFee,
      vsize: bestSize,
      feerate: bestFee / bestSize,
    });
    for (const txid of bestSet) { remaining.delete(txid); }
  }
  return chunks;
}

function buildClusterView(nodes: Map<string, Node>, members: readonly string[]): ClusterView {
  const chunks = linearize(nodes, members);
  const chunkOfTx = new Map<string, number>();
  const linearIndexOfTx = new Map<string, number>();
  let linear = 0;
  for (const chunk of chunks) {
    for (const txid of chunk.txids) {
      chunkOfTx.set(txid, chunk.index);
      linearIndexOfTx.set(txid, linear++);
    }
  }
  const transactions: ClusterTxView[] = [];
  let feeSats = 0;
  let vsize = 0;
  let weight = 0;
  for (const txid of members) {
    const node = nodeAt(nodes, txid);
    const ancestors = ancestorsOf(nodes, txid, null);
    const descendants = descendantsOf(nodes, txid);
    let ancestorFee = node.tx.fee;
    let ancestorVsize = node.tx.vsize;
    for (const a of ancestors) {
      ancestorFee += nodeAt(nodes, a).tx.fee;
      ancestorVsize += nodeAt(nodes, a).tx.vsize;
    }
    let descendantFee = node.tx.fee;
    let descendantVsize = node.tx.vsize;
    for (const d of descendants) {
      descendantFee += nodeAt(nodes, d).tx.fee;
      descendantVsize += nodeAt(nodes, d).tx.vsize;
    }
    const chunkIndex = chunkOfTx.get(txid) ?? -1;
    transactions.push({
      txid,
      vsize: node.tx.vsize,
      weight: node.tx.weight,
      feeSats: node.tx.fee,
      individualFeerate: node.tx.vsize > 0 ? node.tx.fee / node.tx.vsize : 0,
      effectiveFeerate: chunkIndex >= 0 ? chunks[chunkIndex].feerate : 0,
      chunkIndex,
      linearIndex: linearIndexOfTx.get(txid) ?? -1,
      parents: node.parents,
      children: node.children,
      // Counts include the transaction itself, matching how a node reports
      // `ancestorcount` and `descendantcount` in `getmempoolentry`.
      ancestorCount: ancestors.size + 1,
      ancestorFeeSats: ancestorFee,
      ancestorVsize,
      descendantCount: descendants.size + 1,
      descendantFeeSats: descendantFee,
      descendantVsize,
    });
    feeSats += node.tx.fee;
    vsize += node.tx.vsize;
    weight += node.tx.weight;
  }
  transactions.sort((a, b) => a.linearIndex - b.linearIndex);
  return {
    id: [...members].sort()[0],
    txids: [...members].sort(),
    transactions,
    chunks,
    feeSats,
    vsize,
    weight,
    txCount: members.length,
  };
}

/** Builds every cluster in the supplied mempool, fully linearized. */
export function buildClusters(txs: readonly ClusterInputTx[]): ClusterView[] {
  const nodes = buildNodes(txs);
  const clusters: ClusterView[] = [];
  for (const members of findClusters(txs)) {
    clusters.push(buildClusterView(nodes, members));
  }
  return clusters;
}

/** Builds the cluster that contains `txid`, or null when it is not present. */
export function buildClusterFor(
  txs: readonly ClusterInputTx[],
  txid: string,
): ClusterView | null {
  const nodes = buildNodes(txs);
  if (!nodes.has(txid)) { return null; }
  for (const members of findClusters(txs)) {
    if (members.includes(txid)) { return buildClusterView(nodes, members); }
  }
  return null;
}

/**
 * The cumulative fee rate diagram for a set of chunks, already ordered.
 *
 * The first point is the origin so the curve can be drawn without the caller
 * inventing a starting coordinate, and every later point is the end of one
 * chunk. Because chunk fee rates are non-increasing, the curve is concave, and
 * a transaction is worth including exactly while the curve is still climbing
 * faster than the next block's cutoff.
 */
export function feerateDiagram(chunks: readonly ChunkView[]): DiagramPoint[] {
  const points: DiagramPoint[] = [
    { vsize: 0, feeSats: 0, feerate: null, chunkIndex: null },
  ];
  let vsize = 0;
  let feeSats = 0;
  for (const chunk of chunks) {
    vsize += chunk.vsize;
    feeSats += chunk.feeSats;
    points.push({ vsize, feeSats, feerate: chunk.feerate, chunkIndex: chunk.index });
  }
  return points;
}

/**
 * Merges every cluster's chunks into one mempool wide ordering.
 *
 * This is the sequence a miner walks: the highest fee rate chunk anywhere in
 * the mempool, then the next, regardless of which cluster it came from. It is
 * what makes the difference between chunk order and naive per transaction fee
 * rate order visible, which is the whole point of the diagram.
 */
export function mergeChunks(
  clusters: readonly ClusterView[],
): { clusterId: string; chunk: ChunkView }[] {
  const all: { clusterId: string; chunk: ChunkView }[] = [];
  for (const cluster of clusters) {
    for (const chunk of cluster.chunks) {
      all.push({ clusterId: cluster.id, chunk });
    }
  }
  all.sort((a, b) => {
    const order = compareFeerate(
      b.chunk.feeSats, b.chunk.vsize, a.chunk.feeSats, a.chunk.vsize,
    );
    if (order !== 0) { return order; }
    if (a.chunk.vsize !== b.chunk.vsize) { return a.chunk.vsize - b.chunk.vsize; }
    if (a.clusterId !== b.clusterId) { return a.clusterId < b.clusterId ? -1 : 1; }
    return a.chunk.index - b.chunk.index;
  });
  return all;
}
