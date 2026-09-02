import {
  chunkRows,
  computeDepths,
  DEFAULT_LAYOUT,
  layoutCluster,
  layoutDiagram,
  nextBlockCutoff,
  toPath,
} from './cluster-layout';
import { ClusterTxView, ClusterView, DiagramPoint } from './mempool-intelligence.types';

function id(label: string): string {
  return label.padEnd(64, '0');
}

function txView(
  label: string,
  parents: string[],
  chunkIndex: number,
  linearIndex: number,
): ClusterTxView {
  return {
    txid: id(label),
    vsize: 100,
    weight: 400,
    feeSats: 1000,
    individualFeerate: 10,
    effectiveFeerate: 10,
    chunkIndex,
    linearIndex,
    parents: parents.map(id),
    children: [],
    ancestorCount: 1,
    ancestorFeeSats: 1000,
    ancestorVsize: 100,
    descendantCount: 1,
    descendantFeeSats: 1000,
    descendantVsize: 100,
  };
}

function cluster(transactions: ClusterTxView[], chunks: ClusterView['chunks']): ClusterView {
  return {
    id: transactions.length ? transactions[0].txid : '',
    txids: transactions.map((t) => t.txid).sort(),
    transactions,
    chunks,
    feeSats: transactions.reduce((sum, t) => sum + t.feeSats, 0),
    vsize: transactions.reduce((sum, t) => sum + t.vsize, 0),
    weight: transactions.reduce((sum, t) => sum + t.weight, 0),
    txCount: transactions.length,
  };
}

describe('computeDepths', () => {
  it('puts a transaction with no unconfirmed parent at depth zero', () => {
    const depths = computeDepths(cluster([txView('a', [], 0, 0)], []));
    expect(depths.get(id('a'))).toBe(0);
  });

  it('measures depth as the longest path, not the shortest', () => {
    // d has a short route from a and a long one through b and c. Drawing it
    // one column right of a would put it left of c, and its edge from c would
    // then point backwards.
    const depths = computeDepths(cluster([
      txView('a', [], 0, 0),
      txView('b', ['a'], 0, 1),
      txView('c', ['b'], 0, 2),
      txView('d', ['a', 'c'], 0, 3),
    ], []));
    expect(depths.get(id('d'))).toBe(3);
  });

  it('ignores a parent that is not a member of the cluster', () => {
    const depths = computeDepths(cluster([txView('a', ['ff'], 0, 0)], []));
    expect(depths.get(id('a'))).toBe(0);
  });
});

describe('layoutCluster', () => {
  it('places a child to the right of its parent', () => {
    const layout = layoutCluster(cluster([
      txView('a', [], 0, 0),
      txView('b', ['a'], 0, 1),
    ], []));
    const parent = layout.nodes.find((n) => n.txid === id('a'));
    const child = layout.nodes.find((n) => n.txid === id('b'));
    expect(child.x).toBeGreaterThan(parent.x);
  });

  it('never gives two transactions the same position', () => {
    const layout = layoutCluster(cluster([
      txView('a', [], 0, 0),
      txView('b', [], 0, 1),
      txView('c', ['a'], 0, 2),
      txView('d', ['b'], 0, 3),
    ], []));
    const seen = new Set(layout.nodes.map((n) => `${n.x}:${n.y}`));
    expect(seen.size).toBe(layout.nodes.length);
  });

  it('draws an edge for every parent link that stays inside the cluster', () => {
    const layout = layoutCluster(cluster([
      txView('a', [], 0, 0),
      txView('b', ['a', 'ff'], 0, 1),
    ], []));
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].from).toBe(id('a'));
  });

  it('marks whether an edge stays inside one chunk', () => {
    // An edge that crosses a chunk boundary is where a miner would stop, and
    // the graph has to be able to say so without relying on colour alone.
    const layout = layoutCluster(cluster([
      txView('a', [], 0, 0),
      txView('b', ['a'], 0, 1),
      txView('c', ['b'], 1, 2),
    ], []));
    const inside = layout.edges.find((e) => e.to === id('b'));
    const crossing = layout.edges.find((e) => e.to === id('c'));
    expect(inside.withinChunk).toBe(true);
    expect(crossing.withinChunk).toBe(false);
  });

  it('sizes the canvas to hold every node it placed', () => {
    const layout = layoutCluster(cluster([
      txView('a', [], 0, 0),
      txView('b', ['a'], 0, 1),
      txView('c', ['b'], 0, 2),
    ], []));
    for (const node of layout.nodes) {
      expect(node.x + DEFAULT_LAYOUT.nodeRadius).toBeLessThanOrEqual(layout.width);
      expect(node.y + DEFAULT_LAYOUT.nodeRadius).toBeLessThanOrEqual(layout.height);
    }
  });

  it('lays out an empty cluster without producing a negative size', () => {
    const layout = layoutCluster(cluster([], []));
    expect(layout.nodes).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

describe('layoutDiagram', () => {
  const real: DiagramPoint[] = [
    { vsize: 0, feeSats: 0, feerate: null, chunkIndex: null },
    { vsize: 100, feeSats: 1000, feerate: 10, chunkIndex: 0 },
    { vsize: 300, feeSats: 1200, feerate: 1, chunkIndex: 1 },
  ];
  const naive: DiagramPoint[] = [
    { vsize: 0, feeSats: 0, feerate: null, chunkIndex: null },
    { vsize: 100, feeSats: 1000, feerate: 10, chunkIndex: 0 },
    { vsize: 300, feeSats: 1200, feerate: 1, chunkIndex: 1 },
  ];

  it('scales both curves against one shared maximum', () => {
    // Two curves each scaled to their own maximum would look identical no
    // matter how far apart their totals were.
    const layout = layoutDiagram(real, [
      { vsize: 0, feeSats: 0, feerate: null, chunkIndex: null },
      { vsize: 300, feeSats: 600, feerate: 2, chunkIndex: 0 },
    ], 600, 300);
    expect(layout.maxFeeSats).toBe(1200);
    const realEnd = layout.real[layout.real.length - 1];
    const naiveEnd = layout.naive[layout.naive.length - 1];
    expect(naiveEnd.y).toBeGreaterThan(realEnd.y);
  });

  it('draws higher fee further up the box', () => {
    const layout = layoutDiagram(real, naive, 600, 300);
    expect(layout.real[2].y).toBeLessThan(layout.real[0].y);
  });

  it('keeps every projected point inside the box', () => {
    const layout = layoutDiagram(real, naive, 600, 300);
    for (const point of [...layout.real, ...layout.naive]) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(600);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(300);
    }
  });

  it('collapses to the origin for an empty mempool rather than dividing by zero', () => {
    const origin: DiagramPoint[] = [
      { vsize: 0, feeSats: 0, feerate: null, chunkIndex: null },
    ];
    const layout = layoutDiagram(origin, origin, 600, 300);
    expect(Number.isFinite(layout.real[0].x)).toBe(true);
    expect(Number.isFinite(layout.real[0].y)).toBe(true);
  });
});

describe('toPath', () => {
  it('starts with a move and continues with lines', () => {
    const path = toPath([
      { x: 0, y: 10, point: { vsize: 0, feeSats: 0, feerate: null, chunkIndex: null } },
      { x: 5, y: 6, point: { vsize: 1, feeSats: 1, feerate: 1, chunkIndex: 0 } },
    ]);
    expect(path).toBe('M0.00,10.00 L5.00,6.00');
  });

  it('returns an empty string rather than a broken path for no points', () => {
    expect(toPath([])).toBe('');
  });
});

describe('nextBlockCutoff', () => {
  it('finds the first point that fills a block', () => {
    const points = [
      { x: 0, y: 0, point: { vsize: 0, feeSats: 0, feerate: null, chunkIndex: null } },
      { x: 1, y: 1, point: { vsize: 900_000, feeSats: 1, feerate: 1, chunkIndex: 0 } },
      { x: 2, y: 2, point: { vsize: 1_100_000, feeSats: 2, feerate: 1, chunkIndex: 1 } },
    ];
    expect(nextBlockCutoff(points).point.vsize).toBe(1_100_000);
  });

  it('answers null when the mempool does not fill a block', () => {
    // Null is the honest answer. A cutoff invented at the end of a short
    // mempool would draw a block boundary that does not exist.
    const points = [
      { x: 0, y: 0, point: { vsize: 0, feeSats: 0, feerate: null, chunkIndex: null } },
      { x: 1, y: 1, point: { vsize: 500, feeSats: 1, feerate: 1, chunkIndex: 0 } },
    ];
    expect(nextBlockCutoff(points)).toBeNull();
  });
});

describe('chunkRows', () => {
  it('groups transactions under the chunk that holds them', () => {
    const rows = chunkRows(cluster(
      [txView('a', [], 0, 0), txView('b', ['a'], 0, 1), txView('c', ['b'], 1, 2)],
      [
        { index: 0, txids: [id('a'), id('b')], feeSats: 2000, vsize: 200, feerate: 10 },
        { index: 1, txids: [id('c')], feeSats: 1000, vsize: 100, feerate: 10 },
      ],
    ));
    expect(rows).toHaveLength(2);
    expect(rows[0].transactions.map((t) => t.txid)).toEqual([id('a'), id('b')]);
    expect(rows[1].transactions.map((t) => t.txid)).toEqual([id('c')]);
  });

  it('drops a txid the cluster does not describe rather than rendering a blank row', () => {
    const rows = chunkRows(cluster(
      [txView('a', [], 0, 0)],
      [{ index: 0, txids: [id('a'), id('ff')], feeSats: 1000, vsize: 100, feerate: 10 }],
    ));
    expect(rows[0].transactions).toHaveLength(1);
  });
});
