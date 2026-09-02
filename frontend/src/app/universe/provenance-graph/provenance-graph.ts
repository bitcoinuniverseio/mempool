import { RbfTree } from '@interfaces/node-api.interface';

/**
 * The provenance graph's model, built from plain data.
 *
 * Every edge this module draws is a consequence of something the chain or an
 * authority actually said: a prevout a transaction spends, an output a later
 * transaction spent, a replacement the node accepted, a package the cluster
 * engine reported. Nothing infers ownership and nothing merges addresses;
 * the graph describes transactions and outputs, which is what the chain
 * proves.
 *
 * The build is bounded on purpose. A transaction that spends thousands of
 * prevouts, or sits in a package with dozens of relatives, produces the same
 * graph shape with a stated boundary rather than a page that never renders.
 * Whatever was left out is counted in the notes.
 */

export const MAX_NODES = 80;

export type GraphNodeKind = 'prevout' | 'transaction' | 'output' | 'spender';
export type GraphEdgeKind = 'input' | 'output' | 'spend' | 'replacement' | 'package';

export interface GraphTx {
  readonly txid: string;
  readonly confirmed: boolean;
  readonly feeSat: number | null;
  readonly inputs: ReadonlyArray<{ readonly txid: string; readonly vout: number; readonly valueSat: number }>;
  readonly outputs: ReadonlyArray<{ readonly vout: number; readonly valueSat: number }>;
}

export interface GraphOutspend {
  readonly spent: boolean;
  readonly txid: string | null;
}

export interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  /** Router link for the object this node stands for, when one exists. */
  readonly path: string | null;
  readonly valueSat: number | null;
  /** spent, unspent, replaced, or the transaction's own confirmation state. */
  readonly state: string;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: GraphEdgeKind;
  readonly valueSat: number | null;
}

export interface ProvenanceGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly notes: readonly string[];
}

function inputNode(input: GraphTx['inputs'][number]): GraphNode {
  return {
    id: `in:${input.txid}:${input.vout}`,
    kind: 'prevout',
    label: `${input.txid.slice(0, 10)}:${input.vout}`,
    path: `/outpoint/${input.txid}/${input.vout}`,
    valueSat: input.valueSat,
    state: 'spent',
  };
}

function outputNode(txid: string, vout: number, valueSat: number, spent: boolean, spender: string | null): GraphNode {
  return {
    id: `out:${txid}:${vout}`,
    kind: 'output',
    label: `output ${vout}`,
    path: `/outpoint/${txid}/${vout}`,
    valueSat,
    state: spent ? 'spent' : 'unspent',
  };
}

function txNode(txid: string, confirmed: boolean): GraphNode {
  return {
    id: `tx:${txid}`,
    kind: 'transaction',
    label: txid.length > 16 ? `${txid.slice(0, 12)}...` : txid,
    path: `/tx/${txid}`,
    valueSat: null,
    state: confirmed ? 'confirmed' : 'pending',
  };
}

/** Flattens a replacement tree into pairs of replaced and replacement. */
export function replacementPairs(tree: RbfTree | null | undefined): Array<{ readonly replaced: string; readonly replacement: string }> {
  const pairs: Array<{ readonly replaced: string; readonly replacement: string }> = [];
  if (!tree) { return pairs; }
  const walk = (node: RbfTree): void => {
    const replacementId = node.tx?.txid;
    for (const child of node.replaces ?? []) {
      if (child.tx?.txid && replacementId) {
        pairs.push({ replaced: child.tx.txid, replacement: replacementId });
      }
      walk(child);
    }
  };
  walk(tree);
  return pairs;
}

/**
 * Builds the graph.
 *
 * The center transaction, the prevouts it spends, the outputs it creates and
 * what spent them, plus the replacement and package edges the node
 * reported. Every extra set is optional: a graph without replacement or
 * package data is still the true graph of the value flow, and the note says
 * what could not be read.
 */
export function buildProvenanceGraph(
  tx: GraphTx,
  outspends: readonly GraphOutspend[],
  extras: {
    readonly rbfHistory: RbfTree | null;
    readonly replaces: readonly string[];
    readonly packageTxids: readonly string[];
  } = { rbfHistory: null, replaces: [], packageTxids: [] },
): ProvenanceGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();

  const add = (node: GraphNode): boolean => {
    if (seen.has(node.id)) { return true; }
    if (nodes.length >= MAX_NODES) { return false; }
    seen.add(node.id);
    nodes.push(node);
    return true;
  };

  const center = txNode(tx.txid, tx.confirmed);
  add(center);

  for (const input of tx.inputs) {
    if (!add(inputNode(input))) {
      notes.push(`Prevouts past the first ${MAX_NODES - nodes.length} are not drawn. The full list is on the transaction page.`);
      break;
    }
    edges.push({
      from: `in:${input.txid}:${input.vout}`,
      to: center.id,
      kind: 'input',
      valueSat: input.valueSat,
    });
  }

  let truncatedOutputs = false;
  tx.outputs.forEach((output, index) => {
    const outspend = outspends[index] ?? { spent: false, txid: null };
    if (!add(outputNode(tx.txid, output.vout, output.valueSat, outspend.spent, outspend.txid))) {
      truncatedOutputs = true;
      return;
    }
    edges.push({
      from: center.id,
      to: `out:${tx.txid}:${output.vout}`,
      kind: 'output',
      valueSat: output.valueSat,
    });
    if (outspend.spent && outspend.txid) {
      const spender = txNode(outspend.txid, false);
      add(spender);
      edges.push({
        from: `out:${tx.txid}:${output.vout}`,
        to: spender.id,
        kind: 'spend',
        valueSat: output.valueSat,
      });
    }
  });
  if (truncatedOutputs) {
    notes.push(`Outputs past node ${MAX_NODES} are not drawn. The full list is on the transaction page.`);
  }

  // Replacement history: this transaction and the versions it superseded,
  // or the versions that superseded it, are different transactions in the
  // same lineage. Each pair is one edge.
  for (const pair of replacementPairs(extras.rbfHistory)) {
    if (pair.replaced === tx.txid || pair.replacement === tx.txid) {
      const replacedNode = txNode(pair.replaced, true);
      const replacementNode = txNode(pair.replacement, tx.confirmed);
      if (add(replacedNode) && add(replacementNode)) {
        edges.push({
          from: replacedNode.id,
          to: replacementNode.id,
          kind: 'replacement',
          valueSat: null,
        });
      }
    }
  }
  for (const txid of extras.replaces) {
    if (!txid || txid === tx.txid) { continue; }
    const older = txNode(txid, true);
    if (add(older)) {
      edges.push({ from: older.id, to: center.id, kind: 'replacement', valueSat: null });
    }
  }

  // The package or cluster the node reports, when the transaction is still
  // unconfirmed. Confirmed transactions have no package.
  if (!tx.confirmed) {
    for (const txid of extras.packageTxids) {
      if (!txid || txid === tx.txid) { continue; }
      const relative = txNode(txid, false);
      if (add(relative)) {
        edges.push({ from: center.id, to: relative.id, kind: 'package', valueSat: null });
      }
    }
  }

  if (extras.rbfHistory === null && extras.replaces.length === 0) {
    notes.push('No replacement history was available. The graph shows the value flow only.');
  }
  if (notes.length === 0 && nodes.length >= MAX_NODES) {
    notes.push(`The graph is bounded at ${MAX_NODES} nodes.`);
  }

  return { nodes, edges, notes };
}

/** Row count for the accessible table, and for the export previews. */
export function graphRowCounts(graph: ProvenanceGraph): { readonly nodes: number; readonly edges: number } {
  return { nodes: graph.nodes.length, edges: graph.edges.length };
}

const CSV_COLUMNS = ['from', 'to', 'kind', 'value_sat'] as const;

function csvField(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The edge list as CSV: the same facts the drawing shows, as data. */
export function graphCsv(graph: ProvenanceGraph): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const edge of graph.edges) {
    lines.push([edge.from, edge.to, edge.kind, edge.valueSat ?? ''].map(csvField).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** The whole graph as JSON, notes included. */
export function graphJson(graph: ProvenanceGraph): string {
  return JSON.stringify({ schemaVersion: 'universe-provenance-graph-v1', ...graph }, null, 2);
}

export interface LayoutNode extends GraphNode {
  readonly x: number;
  readonly y: number;
}

export interface LayoutEdge extends GraphEdge {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface GraphLayout {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly width: number;
  readonly height: number;
}

const LAYER_BY_KIND: Record<GraphNodeKind, number> = {
  prevout: 0,
  transaction: 1,
  output: 2,
  spender: 3,
};

const COLUMN_WIDTH = 240;
const ROW_HEIGHT = 56;
const PADDING = 24;
const NODE_WIDTH = 90;
const NODE_HEIGHT = 40;

/**
 * A deterministic layered layout.
 *
 * Nodes are ordered by kind, then by the stable order the builder produced,
 * so the same data always draws the same picture. Nothing random, nothing
 * force-directed: a graph that rearranges itself between visits is a graph
 * nobody can learn to read.
 */
export function layoutGraph(graph: ProvenanceGraph): GraphLayout {
  const kindOrder: GraphNodeKind[] = ['prevout', 'transaction', 'output', 'spender'];
  const byKind = new Map<GraphNodeKind, GraphNode[]>();
  for (const node of graph.nodes) {
    const list = byKind.get(node.kind) ?? [];
    list.push(node);
    byKind.set(node.kind, list);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const nodes: LayoutNode[] = [];
  let maxRows = 0;

  for (const kind of kindOrder) {
    const list = byKind.get(kind) ?? [];
    list.forEach((node, index) => {
      const x = PADDING + LAYER_BY_KIND[kind] * COLUMN_WIDTH;
      const y = PADDING + index * ROW_HEIGHT;
      positions.set(node.id, { x, y });
      nodes.push({ ...node, x, y });
    });
    maxRows = Math.max(maxRows, list.length);
  }

  const edges: LayoutEdge[] = graph.edges
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) { return null; }
      return {
        ...edge,
        x1: from.x + NODE_WIDTH,
        y1: from.y + NODE_HEIGHT / 2,
        x2: to.x,
        y2: to.y + NODE_HEIGHT / 2,
      };
    })
    .filter((edge): edge is LayoutEdge => edge !== null);

  const width = PADDING * 2 + 3 * COLUMN_WIDTH;
  const height = PADDING * 2 + Math.max(0, maxRows - 1) * ROW_HEIGHT;
  return { nodes, edges, width, height };
}
