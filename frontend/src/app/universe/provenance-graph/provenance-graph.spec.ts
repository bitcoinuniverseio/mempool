import { describe, expect, it } from 'vitest';

import {
  MAX_NODES,
  buildProvenanceGraph,
  graphCsv,
  graphJson,
  graphRowCounts,
  layoutGraph,
  replacementPairs,
  type GraphOutspend,
  type GraphTx,
} from './provenance-graph';

const TX: GraphTx = {
  txid: 'c'.repeat(64),
  confirmed: false,
  feeSat: 2500,
  inputs: [
    { txid: 'a'.repeat(64), vout: 0, valueSat: 50_000 },
    { txid: 'b'.repeat(64), vout: 1, valueSat: 30_000 },
  ],
  outputs: [
    { vout: 0, valueSat: 70_000 },
    { vout: 1, valueSat: 7_500 },
  ],
};

const OUTSPENDS: readonly GraphOutspend[] = [
  { spent: true, txid: 'd'.repeat(64) },
  { spent: false, txid: null },
];

describe('buildProvenanceGraph', () => {
  it('draws the value flow: prevouts in, outputs out, the spender beyond', () => {
    const graph = buildProvenanceGraph(TX, OUTSPENDS);
    const kinds = graph.edges.map((edge) => edge.kind);
    expect(kinds.filter((kind) => kind === 'input')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'output')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'spend')).toHaveLength(1);
  });

  it('marks a spent output with its spender and an unspent one without', () => {
    const graph = buildProvenanceGraph(TX, OUTSPENDS);
    const spent = graph.nodes.find((node) => node.id === 'out:' + 'c'.repeat(64) + ':0');
    const unspent = graph.nodes.find((node) => node.id === 'out:' + 'c'.repeat(64) + ':1');
    expect(spent?.state).toBe('spent');
    expect(unspent?.state).toBe('unspent');
    expect(graph.edges.some((edge) => edge.to === 'tx:' + 'd'.repeat(64) && edge.kind === 'spend')).toBe(true);
  });

  it('carries exact values on input, output, and spend edges', () => {
    const graph = buildProvenanceGraph(TX, OUTSPENDS);
    const input = graph.edges.find((edge) => edge.kind === 'input');
    expect(input?.valueSat).toBe(50_000);
    const spend = graph.edges.find((edge) => edge.kind === 'spend');
    expect(spend?.valueSat).toBe(70_000);
  });

  it('marks the center transaction pending or confirmed as it is', () => {
    const pending = buildProvenanceGraph(TX, OUTSPENDS).nodes.find((node) => node.kind === 'transaction' && node.id === 'tx:' + 'c'.repeat(64));
    expect(pending?.state).toBe('pending');
    const confirmed = buildProvenanceGraph({ ...TX, confirmed: true }, OUTSPENDS)
      .nodes.find((node) => node.id === 'tx:' + 'c'.repeat(64));
    expect(confirmed?.state).toBe('confirmed');
  });

  it('adds a replacement edge when this transaction replaced another', () => {
    const graph = buildProvenanceGraph(TX, OUTSPENDS, {
      rbfHistory: null,
      replaces: ['e'.repeat(64)],
      packageTxids: [],
    });
    const edge = graph.edges.find((item) => item.kind === 'replacement');
    expect(edge).toEqual({
      from: 'tx:' + 'e'.repeat(64),
      to: 'tx:' + 'c'.repeat(64),
      kind: 'replacement',
      valueSat: null,
    });
  });

  it('adds package relatives only while the transaction is unconfirmed', () => {
    const extras = { rbfHistory: null, replaces: [], packageTxids: ['f'.repeat(64)] };
    const pending = buildProvenanceGraph(TX, OUTSPENDS, extras);
    expect(pending.edges.some((edge) => edge.kind === 'package')).toBe(true);
    const confirmed = buildProvenanceGraph({ ...TX, confirmed: true }, OUTSPENDS, extras);
    expect(confirmed.edges.some((edge) => edge.kind === 'package')).toBe(false);
  });

  it('states when replacement history was unavailable instead of staying silent', () => {
    const graph = buildProvenanceGraph(TX, OUTSPENDS);
    expect(graph.notes.some((note) => note.includes('replacement'))).toBe(true);
  });

  it('says nothing when the graph is complete', () => {
    const graph = buildProvenanceGraph(TX, OUTSPENDS, {
      rbfHistory: { tx: { txid: TX.txid } as any, time: 0, fullRbf: false, replaces: [] },
      replaces: [],
      packageTxids: [],
    });
    expect(graph.notes).toHaveLength(0);
  });

  it('bounds the drawing and says what it left out', () => {
    const manyInputs: GraphTx = {
      ...TX,
      inputs: Array.from({ length: MAX_NODES + 10 }, (_, i) => ({
        txid: String(i).padStart(2, '0').repeat(32),
        vout: 0,
        valueSat: 100,
      })),
    };
    const graph = buildProvenanceGraph(manyInputs, []);
    expect(graph.nodes.length).toBe(MAX_NODES);
    expect(graph.notes.some((note) => note.includes('not drawn'))).toBe(true);
  });
});

describe('replacementPairs', () => {
  it('flattens a replacement tree into lineage pairs', () => {
    const tree = {
      tx: { txid: 'new' },
      time: 0,
      fullRbf: false,
      replaces: [
        { tx: { txid: 'old1' }, time: 0, fullRbf: false, replaces: [{ tx: { txid: 'older' }, time: 0, fullRbf: false, replaces: [] }] },
        { tx: { txid: 'old2' }, time: 0, fullRbf: false, replaces: [] },
      ],
    } as any;
    const pairs = replacementPairs(tree);
    expect(pairs).toContainEqual({ replaced: 'old1', replacement: 'new' });
    expect(pairs).toContainEqual({ replaced: 'older', replacement: 'old1' });
    expect(pairs).toContainEqual({ replaced: 'old2', replacement: 'new' });
  });
});

describe('exports', () => {
  const graph = buildProvenanceGraph(TX, OUTSPENDS);

  it('counts rows for the accessible table', () => {
    const counts = graphRowCounts(graph);
    expect(counts.nodes).toBe(graph.nodes.length);
    expect(counts.edges).toBe(graph.edges.length);
  });

  it('exports the edge list as CSV with a header', () => {
    const csv = graphCsv(graph);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('from,to,kind,value_sat');
    expect(lines).toHaveLength(graph.edges.length + 1);
  });

  it('exports the whole graph as versioned JSON', () => {
    const parsed = JSON.parse(graphJson(graph));
    expect(parsed.schemaVersion).toBe('universe-provenance-graph-v1');
    expect(parsed.nodes).toHaveLength(graph.nodes.length);
    expect(parsed.notes).toEqual(graph.notes);
  });
});

describe('layoutGraph', () => {
  it('places every kind in its own layer and never rearranges', () => {
    const graph = buildProvenanceGraph(TX, OUTSPENDS);
    const layout = layoutGraph(graph);
    const byKind = (kind: string): number[] =>
      layout.nodes.filter((node) => node.kind === kind).map((node) => node.x);
    const xs = (list: number[]): Set<number> => new Set(list);
    expect(xs(byKind('prevout')).size).toBe(1);
    expect(xs(byKind('output')).size).toBe(1);
    expect(new Set(byKind('prevout'))).not.toEqual(new Set(byKind('output')));
    const again = layoutGraph(graph);
    expect(again).toEqual(layout);
  });

  it('sizes the drawing to the content', () => {
    const graph = buildProvenanceGraph(TX, OUTSPENDS);
    const layout = layoutGraph(graph);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});
