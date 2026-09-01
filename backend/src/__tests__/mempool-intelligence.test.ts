import { MempoolTransactionExtended } from '../mempool.interfaces';
import intelligence, {
  FRESHNESS_BUDGET_MS,
  toClusterInputs,
} from '../api/mempool-intelligence/mempool-intelligence';

function id(label: string): string {
  return label.padEnd(64, '0');
}

/**
 * A mempool entry with only the fields the cluster path reads. The rest of
 * `MempoolTransactionExtended` describes things this product does not use, so
 * building it out in full would obscure what the test is actually about.
 */
function entry(
  label: string,
  fee: number,
  vsize: number,
  parents: string[] = [],
  extra: Partial<MempoolTransactionExtended> = {},
): MempoolTransactionExtended {
  return {
    txid: id(label),
    fee,
    vsize,
    weight: vsize * 4,
    vin: parents.map((parent) => ({ txid: id(parent), vout: 0 })),
    ...extra,
  } as unknown as MempoolTransactionExtended;
}

function mempoolOf(
  entries: MempoolTransactionExtended[],
): { [txid: string]: MempoolTransactionExtended } {
  const out: { [txid: string]: MempoolTransactionExtended } = {};
  for (const item of entries) { out[item.txid] = item; }
  return out;
}

beforeEach(() => intelligence.invalidate());

describe('toClusterInputs', () => {
  it('keeps only the parents that are themselves in the mempool', () => {
    const inputs = toClusterInputs(mempoolOf([
      entry('a', 100, 100),
      entry('b', 100, 100, ['a', 'zz']),
    ]));
    const child = inputs.find((tx) => tx.txid === id('b'));
    expect(child?.parents).toEqual([id('a')]);
  });

  it('collapses a transaction that spends the same parent twice', () => {
    // Two inputs from one parent is one dependency, not two, and counting it
    // twice would distort every ancestor total downstream.
    const inputs = toClusterInputs(mempoolOf([
      entry('a', 100, 100),
      entry('b', 100, 100, ['a', 'a']),
    ]));
    expect(inputs.find((tx) => tx.txid === id('b'))?.parents).toEqual([id('a')]);
  });

  it('charges the sigop adjusted size when the node has computed one', () => {
    // A transaction can be cheap in bytes and expensive in signature
    // operations. The block assembler charges the adjusted size, so the
    // linearizer has to as well or its chunks will not match a real template.
    const inputs = toClusterInputs(mempoolOf([
      entry('a', 100, 100, [], { adjustedVsize: 250 }),
    ]));
    expect(inputs[0].vsize).toBe(250);
  });

  it('falls back to plain vsize when no adjustment has been made', () => {
    const inputs = toClusterInputs(mempoolOf([entry('a', 100, 137)]));
    expect(inputs[0].vsize).toBe(137);
  });

  it('returns the same list whatever order the mempool keys are in', () => {
    const forwards = toClusterInputs(mempoolOf([
      entry('a', 100, 100), entry('b', 100, 100), entry('c', 100, 100),
    ]));
    const backwards = toClusterInputs(mempoolOf([
      entry('c', 100, 100), entry('b', 100, 100), entry('a', 100, 100),
    ]));
    expect(backwards).toEqual(forwards);
  });

  it('handles an entry with no inputs at all', () => {
    const inputs = toClusterInputs(mempoolOf([
      entry('a', 100, 100, [], { vin: undefined }),
    ]));
    expect(inputs[0].parents).toEqual([]);
  });
});

describe('listClusters', () => {
  it('puts the cluster a miner reaches first at the front', () => {
    const mempool = mempoolOf([
      entry('a', 100, 100),
      entry('b', 200, 100),
      entry('c', 900, 100),
    ]);
    const result = intelligence.listClusters(mempool, 0, 10);
    expect(result.clusters.map((c) => c.id)).toEqual([id('c'), id('b'), id('a')]);
    expect(result.total).toBe(3);
  });

  it('reports the full count alongside the page, not just the page size', () => {
    // A total that only counted the returned page would let a reader believe
    // they had seen the whole mempool.
    const mempool = mempoolOf([
      entry('a', 100, 100), entry('b', 200, 100), entry('c', 900, 100),
    ]);
    const result = intelligence.listClusters(mempool, 1, 1);
    expect(result.clusters).toHaveLength(1);
    expect(result.total).toBe(3);
    expect(result.offset).toBe(1);
  });

  it('counts only the clusters the caller asked for when filtering', () => {
    // A total that counted every cluster while the page held only packages
    // would make the paging report more than it could ever show.
    const mempool = mempoolOf([
      entry('a', 100, 100),
      entry('b', 1000, 100, ['a']),
      entry('c', 900, 100),
    ]);
    const all = intelligence.listClusters(mempool, 0, 10);
    const packages = intelligence.listClusters(mempool, 0, 10, Date.now(), 2);
    expect(all.total).toBe(2);
    expect(packages.total).toBe(1);
    expect(packages.clusters[0].id).toBe(id('a'));
  });

  it('describes a child pays for parent cluster as one cluster', () => {
    const result = intelligence.listClusters(mempoolOf([
      entry('a', 100, 100),
      entry('b', 1000, 100, ['a']),
    ]), 0, 10);
    expect(result.total).toBe(1);
    expect(result.clusters[0].txCount).toBe(2);
    expect(result.clusters[0].chunkCount).toBe(1);
    expect(result.clusters[0].topFeerate).toBeCloseTo(5.5, 10);
  });
});

describe('freshness', () => {
  it('reports the age of the snapshot rather than implying it is live', () => {
    const mempool = mempoolOf([entry('a', 100, 100)]);
    intelligence.listClusters(mempool, 0, 10, 1000);
    const later = intelligence.listClusters(mempool, 0, 10, 3000);
    expect(later.freshness.ageMs).toBe(2000);
    expect(later.freshness.withinBudget).toBe(true);
    expect(later.freshness.builtAt).toBe(new Date(1000).toISOString());
  });

  it('rebuilds once the snapshot has aged past its budget', () => {
    const mempool = mempoolOf([entry('a', 100, 100)]);
    intelligence.listClusters(mempool, 0, 10, 1000);
    const rebuilt = intelligence.listClusters(
      mempool, 0, 10, 1000 + FRESHNESS_BUDGET_MS + 1,
    );
    expect(rebuilt.freshness.ageMs).toBe(0);
  });

  it('rebuilds immediately when the mempool size has changed', () => {
    // Waiting out the budget after a block arrived would serve membership the
    // node no longer has.
    const before = mempoolOf([entry('a', 100, 100)]);
    intelligence.listClusters(before, 0, 10, 1000);
    const after = mempoolOf([entry('a', 100, 100), entry('b', 100, 100)]);
    const result = intelligence.listClusters(after, 0, 10, 1200);
    expect(result.total).toBe(2);
    expect(result.freshness.ageMs).toBe(0);
  });

  it('states the budget it is working to', () => {
    const result = intelligence.listClusters(mempoolOf([entry('a', 1, 1)]), 0, 1);
    expect(result.freshness.budgetMs).toBe(FRESHNESS_BUDGET_MS);
  });
});

describe('getCluster', () => {
  const mempool = mempoolOf([
    entry('a', 100, 100),
    entry('b', 1000, 100, ['a']),
    entry('c', 900, 100),
  ]);

  it('finds a cluster by its id', () => {
    const found = intelligence.getCluster(mempool, id('a'));
    expect(found?.cluster.txids).toEqual([id('a'), id('b')]);
  });

  it('finds the same cluster by any member txid', () => {
    // A reader arrives from a transaction page knowing only the txid.
    const found = intelligence.getCluster(mempool, id('b'));
    expect(found?.cluster.id).toBe(id('a'));
  });

  it('answers null for a txid the mempool does not hold', () => {
    expect(intelligence.getCluster(mempool, id('zz'))).toBeNull();
  });
});

describe('getDiagram', () => {
  it('draws a concave curve from the chunk ordering', () => {
    const result = intelligence.getDiagram(mempoolOf([
      entry('a', 100, 100),
      entry('b', 1000, 100, ['a']),
      entry('c', 900, 100),
      entry('d', 50, 100),
    ]));
    const slopes: number[] = [];
    for (let i = 1; i < result.points.length; i++) {
      slopes.push(
        (result.points[i].feeSats - result.points[i - 1].feeSats)
        / (result.points[i].vsize - result.points[i - 1].vsize),
      );
    }
    for (let i = 1; i < slopes.length; i++) {
      expect(slopes[i]).toBeLessThanOrEqual(slopes[i - 1]);
    }
  });

  it('ends both curves at the same total, since they order the same mempool', () => {
    const result = intelligence.getDiagram(mempoolOf([
      entry('a', 100, 100),
      entry('b', 1000, 100, ['a']),
      entry('c', 900, 100),
    ]));
    const real = result.points[result.points.length - 1];
    const naive = result.naivePoints[result.naivePoints.length - 1];
    expect(naive.vsize).toBe(real.vsize);
    expect(naive.feeSats).toBe(real.feeSats);
    expect(result.totalFeeSats).toBe(2000);
    expect(result.totalVsize).toBe(300);
  });

  it('shows the naive ordering claiming more fee than a miner could take', () => {
    // The naive curve sorts the rich child above its poor parent, which no
    // miner can actually do. Early on it therefore sits above the real curve,
    // and that gap is exactly the thing the page exists to explain.
    const result = intelligence.getDiagram(mempoolOf([
      entry('a', 10, 100),
      entry('b', 1000, 100, ['a']),
    ]));
    expect(result.naivePoints[1].feeSats).toBe(1000);
    expect(result.points[1].feeSats).toBe(1010);
    expect(result.naivePoints[1].vsize).toBe(100);
    expect(result.points[1].vsize).toBe(200);
  });

  it('returns just the origin for an empty mempool', () => {
    const result = intelligence.getDiagram({});
    expect(result.points).toHaveLength(1);
    expect(result.chunkCount).toBe(0);
    expect(result.totalVsize).toBe(0);
  });
});

describe('getPackageFor', () => {
  it('reports the same chunk the cluster page reports', () => {
    const mempool = mempoolOf([
      entry('a', 100, 100),
      entry('b', 1000, 100, ['a']),
    ]);
    const pkg = intelligence.getPackageFor(mempool, id('b'));
    const cluster = intelligence.getCluster(mempool, id('a'));
    const fromPackage = pkg?.cluster.transactions.find((t) => t.txid === id('b'));
    const fromCluster = cluster?.cluster.transactions.find((t) => t.txid === id('b'));
    expect(fromPackage?.chunkIndex).toBe(fromCluster?.chunkIndex);
    expect(fromPackage?.effectiveFeerate).toBe(fromCluster?.effectiveFeerate);
  });

  it('answers null for a transaction that is not unconfirmed here', () => {
    expect(intelligence.getPackageFor(mempoolOf([entry('a', 1, 1)]), id('zz')))
      .toBeNull();
  });
});
