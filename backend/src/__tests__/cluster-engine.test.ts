import {
  buildClusterFor,
  buildClusters,
  compareFeerate,
  feerateDiagram,
  findClusters,
  mergeChunks,
  type ClusterInputTx,
} from '../api/mempool-intelligence/cluster-engine';

/**
 * Readable txids. The linearizer breaks ties on txid, so tests that care about
 * ordering need ids whose sort order is obvious to a reader.
 */
function id(label: string): string {
  return label.padEnd(64, '0');
}

function tx(
  label: string,
  fee: number,
  vsize: number,
  parents: string[] = [],
): ClusterInputTx {
  return {
    txid: id(label),
    fee,
    vsize,
    weight: vsize * 4,
    parents: parents.map(id),
  };
}

/** Fails the test with a clear message instead of a null dereference. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error('expected ' + what + ' to be present');
  }
  return value;
}

describe('compareFeerate', () => {
  it('orders by rate without dividing', () => {
    expect(compareFeerate(100, 10, 50, 10)).toBeGreaterThan(0);
    expect(compareFeerate(50, 10, 100, 10)).toBeLessThan(0);
    expect(compareFeerate(100, 10, 200, 20)).toBe(0);
  });

  it('separates rates that a double would collapse', () => {
    // Both rates are 1 sat/vB to within the precision of a double once
    // divided, but they are genuinely different numbers.
    const leftFee = Number.MAX_SAFE_INTEGER;
    const rightFee = Number.MAX_SAFE_INTEGER - 1;
    expect(leftFee / 1 === rightFee / 1).toBe(false);
    expect(compareFeerate(leftFee, 1, rightFee, 1)).toBeGreaterThan(0);
  });
});

describe('findClusters', () => {
  it('treats unrelated transactions as separate clusters', () => {
    const clusters = findClusters([tx('a', 1000, 100), tx('b', 1000, 100)]);
    expect(clusters).toEqual([[id('a')], [id('b')]]);
  });

  it('pulls a parent and child into one cluster', () => {
    const clusters = findClusters([tx('a', 1000, 100), tx('b', 1000, 100, ['a'])]);
    expect(clusters).toEqual([[id('a'), id('b')]]);
  });

  it('joins two parents through a shared child', () => {
    const clusters = findClusters([
      tx('a', 1000, 100),
      tx('b', 1000, 100),
      tx('c', 1000, 100, ['a', 'b']),
    ]);
    expect(clusters).toEqual([[id('a'), id('b'), id('c')]]);
  });

  it('ignores parents that are not in the mempool', () => {
    // A confirmed parent is not a cluster member, and inventing one would
    // report a cluster the node does not have.
    const clusters = findClusters([tx('b', 1000, 100, ['zzz'])]);
    expect(clusters).toEqual([[id('b')]]);
  });

  it('produces the same clusters whatever order the mempool is read in', () => {
    const txs = [
      tx('a', 1000, 100),
      tx('b', 2000, 100, ['a']),
      tx('c', 500, 100),
      tx('d', 900, 100, ['c']),
    ];
    const forwards = findClusters(txs);
    const backwards = findClusters([...txs].reverse());
    expect(backwards).toEqual(forwards);
  });
});

describe('linearization', () => {
  it('mines a high fee child together with its low fee parent', () => {
    // The classic child pays for parent case. On its own the parent is worth
    // 1 sat/vB, but the pair is worth 5.5, so a miner takes them together.
    const [cluster] = buildClusters([
      tx('a', 100, 100),
      tx('b', 1000, 100, ['a']),
    ]);
    expect(cluster.chunks).toHaveLength(1);
    expect(cluster.chunks[0].txids).toEqual([id('a'), id('b')]);
    expect(cluster.chunks[0].feeSats).toBe(1100);
    expect(cluster.chunks[0].vsize).toBe(200);
    expect(cluster.chunks[0].feerate).toBeCloseTo(5.5, 10);
  });

  it('gives every member of a chunk the same effective fee rate', () => {
    const [cluster] = buildClusters([
      tx('a', 100, 100),
      tx('b', 1000, 100, ['a']),
    ]);
    const parent = must(cluster.transactions.find((t) => t.txid === id('a')), 'parent');
    const child = must(cluster.transactions.find((t) => t.txid === id('b')), 'child');
    expect(parent.individualFeerate).toBeCloseTo(1, 10);
    expect(child.individualFeerate).toBeCloseTo(10, 10);
    expect(parent.effectiveFeerate).toBeCloseTo(5.5, 10);
    expect(child.effectiveFeerate).toBeCloseTo(5.5, 10);
  });

  it('splits a cluster whose descendant does not help its parent', () => {
    // A rich parent followed by a poor child: the miner takes the parent
    // first, and the child becomes its own, cheaper chunk.
    const [cluster] = buildClusters([
      tx('a', 1000, 100),
      tx('b', 100, 100, ['a']),
    ]);
    expect(cluster.chunks).toHaveLength(2);
    expect(cluster.chunks[0].txids).toEqual([id('a')]);
    expect(cluster.chunks[1].txids).toEqual([id('b')]);
    expect(cluster.chunks[0].feerate).toBeGreaterThan(cluster.chunks[1].feerate);
  });

  it('never emits a chunk whose rate is above the chunk before it', () => {
    // The property the whole fee rate diagram rests on. A rising chunk would
    // mean the miner passed over money it could have taken sooner.
    const txs: ClusterInputTx[] = [
      tx('a', 5000, 100),
      tx('b', 200, 150, ['a']),
      tx('c', 9000, 120, ['b']),
      tx('d', 100, 100, ['a']),
      tx('e', 4000, 100, ['c', 'd']),
      tx('f', 50, 400, ['e']),
    ];
    const [cluster] = buildClusters(txs);
    expect(cluster.chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < cluster.chunks.length; i++) {
      const previous = cluster.chunks[i - 1];
      const current = cluster.chunks[i];
      expect(
        compareFeerate(current.feeSats, current.vsize, previous.feeSats, previous.vsize),
      ).toBeLessThanOrEqual(0);
    }
  });

  it('places every parent before its children in the linearization', () => {
    const txs: ClusterInputTx[] = [
      tx('a', 5000, 100),
      tx('b', 200, 150, ['a']),
      tx('c', 9000, 120, ['b']),
      tx('d', 100, 100, ['a']),
      tx('e', 4000, 100, ['c', 'd']),
    ];
    const [cluster] = buildClusters(txs);
    const position = new Map<string, number>();
    cluster.transactions.forEach((t, index) => position.set(t.txid, index));
    for (const t of cluster.transactions) {
      for (const parent of t.parents) {
        expect(must(position.get(parent), 'parent position'))
          .toBeLessThan(must(position.get(t.txid), 'child position'));
      }
    }
  });

  it('covers every member exactly once across all chunks', () => {
    const txs: ClusterInputTx[] = [
      tx('a', 5000, 100),
      tx('b', 200, 150, ['a']),
      tx('c', 9000, 120, ['b']),
      tx('d', 100, 100, ['a']),
      tx('e', 4000, 100, ['c', 'd']),
    ];
    const [cluster] = buildClusters(txs);
    const seen = cluster.chunks.flatMap((chunk) => [...chunk.txids]);
    expect(seen.slice().sort()).toEqual([...cluster.txids]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('conserves fee and size between the cluster and its chunks', () => {
    const txs: ClusterInputTx[] = [
      tx('a', 5000, 100),
      tx('b', 200, 150, ['a']),
      tx('c', 9000, 120, ['b']),
    ];
    const [cluster] = buildClusters(txs);
    const chunkFee = cluster.chunks.reduce((sum, c) => sum + c.feeSats, 0);
    const chunkVsize = cluster.chunks.reduce((sum, c) => sum + c.vsize, 0);
    expect(chunkFee).toBe(cluster.feeSats);
    expect(chunkVsize).toBe(cluster.vsize);
    expect(cluster.feeSats).toBe(14200);
    expect(cluster.vsize).toBe(370);
  });

  it('linearizes the same cluster the same way whatever the input order', () => {
    const txs: ClusterInputTx[] = [
      tx('a', 5000, 100),
      tx('b', 200, 150, ['a']),
      tx('c', 9000, 120, ['b']),
      tx('d', 100, 100, ['a']),
    ];
    const forwards = buildClusters(txs)[0];
    const backwards = buildClusters([...txs].reverse())[0];
    expect(backwards.chunks).toEqual(forwards.chunks);
    expect(backwards.transactions).toEqual(forwards.transactions);
  });
});

describe('ancestor and descendant aggregates', () => {
  it('counts the transaction itself, as getmempoolentry does', () => {
    const [cluster] = buildClusters([
      tx('a', 100, 100),
      tx('b', 200, 100, ['a']),
      tx('c', 300, 100, ['b']),
    ]);
    const middle = must(cluster.transactions.find((t) => t.txid === id('b')), 'middle');
    expect(middle.ancestorCount).toBe(2);
    expect(middle.ancestorFeeSats).toBe(300);
    expect(middle.ancestorVsize).toBe(200);
    expect(middle.descendantCount).toBe(2);
    expect(middle.descendantFeeSats).toBe(500);
    expect(middle.descendantVsize).toBe(200);
  });

  it('does not double count a diamond shaped ancestry', () => {
    // d has two parents that share one grandparent. Counting the grandparent
    // twice would overstate what a miner has to include.
    const [cluster] = buildClusters([
      tx('a', 100, 100),
      tx('b', 100, 100, ['a']),
      tx('c', 100, 100, ['a']),
      tx('d', 100, 100, ['b', 'c']),
    ]);
    const tip = must(cluster.transactions.find((t) => t.txid === id('d')), 'tip');
    expect(tip.ancestorCount).toBe(4);
    expect(tip.ancestorFeeSats).toBe(400);
    expect(tip.ancestorVsize).toBe(400);
  });
});

describe('feerateDiagram', () => {
  it('starts at the origin and ends at the cluster total', () => {
    const [cluster] = buildClusters([
      tx('a', 1000, 100),
      tx('b', 100, 100, ['a']),
    ]);
    const points = feerateDiagram(cluster.chunks);
    expect(points[0]).toEqual({ vsize: 0, feeSats: 0, feerate: null, chunkIndex: null });
    expect(points[points.length - 1].vsize).toBe(cluster.vsize);
    expect(points[points.length - 1].feeSats).toBe(cluster.feeSats);
  });

  it('is concave, so each step is never steeper than the one before it', () => {
    const [cluster] = buildClusters([
      tx('a', 5000, 100),
      tx('b', 200, 150, ['a']),
      tx('c', 9000, 120, ['b']),
      tx('d', 60, 300, ['c']),
    ]);
    const points = feerateDiagram(cluster.chunks);
    for (let i = 2; i < points.length; i++) {
      const previousSlope = (points[i - 1].feeSats - points[i - 2].feeSats)
        / (points[i - 1].vsize - points[i - 2].vsize);
      const slope = (points[i].feeSats - points[i - 1].feeSats)
        / (points[i].vsize - points[i - 1].vsize);
      expect(slope).toBeLessThanOrEqual(previousSlope);
    }
  });

  it('returns just the origin for an empty mempool', () => {
    expect(feerateDiagram([])).toEqual([
      { vsize: 0, feeSats: 0, feerate: null, chunkIndex: null },
    ]);
  });
});

describe('mergeChunks', () => {
  it('orders chunks from every cluster by fee rate', () => {
    const clusters = buildClusters([
      tx('a', 100, 100),
      tx('b', 1000, 100, ['a']),
      tx('c', 900, 100),
      tx('d', 200, 100),
    ]);
    const merged = mergeChunks(clusters);
    const rates = merged.map((entry) => entry.chunk.feerate);
    expect(rates).toEqual([...rates].sort((x, y) => y - x));
    // c at 9 sat/vB outranks the a+b chunk at 5.5, which outranks d at 2.
    expect(merged[0].clusterId).toBe(id('c'));
    expect(merged[1].clusterId).toBe(id('a'));
    expect(merged[2].clusterId).toBe(id('d'));
  });

  it('breaks ties deterministically rather than by traversal order', () => {
    const clusters = buildClusters([tx('a', 500, 100), tx('b', 500, 100)]);
    const merged = mergeChunks(clusters);
    expect(merged.map((entry) => entry.clusterId)).toEqual([id('a'), id('b')]);
    expect(mergeChunks([...clusters].reverse()).map((e) => e.clusterId))
      .toEqual([id('a'), id('b')]);
  });
});

describe('buildClusterFor', () => {
  it('finds the cluster a transaction belongs to', () => {
    const txs = [tx('a', 100, 100), tx('b', 1000, 100, ['a']), tx('c', 900, 100)];
    const cluster = must(buildClusterFor(txs, id('b')), 'cluster');
    expect(cluster.id).toBe(id('a'));
    expect(cluster.txids).toEqual([id('a'), id('b')]);
  });

  it('answers null for a transaction that is not in the mempool', () => {
    // Absent has to read as absent. Returning an empty cluster would let a
    // page claim it had shown the whole neighbourhood of a transaction it
    // never found.
    expect(buildClusterFor([tx('a', 100, 100)], id('zz'))).toBeNull();
  });
});

describe('degenerate input', () => {
  it('ignores a transaction that claims itself as a parent', () => {
    const clusters = buildClusters([tx('a', 100, 100, ['a'])]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].transactions[0].parents).toEqual([]);
  });

  it('handles an empty mempool', () => {
    expect(buildClusters([])).toEqual([]);
    expect(findClusters([])).toEqual([]);
    expect(mergeChunks([])).toEqual([]);
  });

  it('does not divide by zero on a zero size transaction', () => {
    const clusters = buildClusters([tx('a', 0, 0)]);
    expect(clusters[0].transactions[0].individualFeerate).toBe(0);
  });
});
