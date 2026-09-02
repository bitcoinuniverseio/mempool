import {
  queuePositionFor,
  simulatePackage,
  type CandidateTx,
  type ConflictingTx,
  type MempoolLookup,
  type NodeVerdict,
} from '../api/mempool-intelligence/package-simulator';

/** Readable txids, since the linearizer breaks ties on them. */
function id(label: string): string {
  return label.padEnd(64, '0');
}

function candidate(options: {
  label: string;
  vsize?: number;
  inputs?: { txid: string; vout: number }[];
  outputs?: number[];
}): CandidateTx {
  const vsize = options.vsize ?? 100;
  return {
    txid: id(options.label),
    vsize,
    weight: vsize * 4,
    inputs: options.inputs ?? [{ txid: id('external'), vout: 0 }],
    outputValuesSats: options.outputs ?? [1000],
  };
}

function verdict(options: {
  label: string;
  allowed?: boolean;
  reason?: string | null;
  vsize?: number;
  feeSats?: number | null;
  effectiveFeerate?: number | null;
}): NodeVerdict {
  return {
    txid: id(options.label),
    allowed: options.allowed ?? true,
    rejectReason: options.reason ?? null,
    vsize: options.vsize ?? 100,
    feeSats: options.feeSats === undefined ? 1000 : options.feeSats,
    effectiveFeerate: options.effectiveFeerate ?? null,
    effectiveIncludes: [],
  };
}

/** A mempool stated by the test, so the arithmetic is checked against it. */
function mempoolOf(options: {
  spends?: Record<string, ConflictingTx>;
  families?: Record<string, ConflictingTx[]>;
  present?: string[];
  outputs?: Record<string, number>;
} = {}): MempoolLookup {
  return {
    spender: (txid, vout) => options.spends?.[`${txid}:${vout}`] ?? null,
    descendants: (txid) => options.families?.[txid] ?? [],
    has: (txid) => (options.present ?? []).includes(txid),
    outputValue: (txid, vout) => options.outputs?.[`${txid}:${vout}`] ?? null,
  };
}

const POLICY = { incrementalRelayFeeSatPerVb: 1 };

describe('package topology', () => {
  it('finds the parent edges inside the package', () => {
    const parent = candidate({ label: 'aaa', outputs: [9000] });
    const child = candidate({
      label: 'bbb',
      inputs: [{ txid: id('aaa'), vout: 0 }],
      outputs: [8000],
    });
    const result = simulatePackage({
      candidates: [child, parent],
      verdicts: [verdict({ label: 'aaa' }), verdict({ label: 'bbb' })],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    const childView = result.transactions.find((t) => t.txid === id('bbb'));
    expect(childView?.parents).toEqual([id('aaa')]);
    const parentView = result.transactions.find((t) => t.txid === id('aaa'));
    expect(parentView?.children).toEqual([id('bbb')]);
  });

  it('orders parents before children whatever order they arrive in', () => {
    const result = simulatePackage({
      candidates: [
        candidate({ label: 'ccc', inputs: [{ txid: id('bbb'), vout: 0 }] }),
        candidate({ label: 'bbb', inputs: [{ txid: id('aaa'), vout: 0 }] }),
        candidate({ label: 'aaa' }),
      ],
      verdicts: ['aaa', 'bbb', 'ccc'].map((label) => verdict({ label })),
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.topologicalOrder).toEqual([id('aaa'), id('bbb'), id('ccc')]);
    expect(result.cyclic).toBe(false);
  });

  it('reports a cycle rather than producing an order that is not one', () => {
    const result = simulatePackage({
      candidates: [
        candidate({ label: 'aaa', inputs: [{ txid: id('bbb'), vout: 0 }] }),
        candidate({ label: 'bbb', inputs: [{ txid: id('aaa'), vout: 0 }] }),
      ],
      verdicts: ['aaa', 'bbb'].map((label) => verdict({ label })),
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.cyclic).toBe(true);
    expect(result.topologicalOrder).toEqual([]);
    // A cycle cannot be linearized, so no group is claimed for it.
    expect(result.chunks).toEqual([]);
  });

  it('counts a parent spent twice once', () => {
    const result = simulatePackage({
      candidates: [
        candidate({ label: 'aaa', outputs: [5000, 5000] }),
        candidate({
          label: 'bbb',
          inputs: [{ txid: id('aaa'), vout: 0 }, { txid: id('aaa'), vout: 1 }],
        }),
      ],
      verdicts: ['aaa', 'bbb'].map((label) => verdict({ label })),
      mempool: mempoolOf(),
      policy: POLICY,
    });
    const child = result.transactions.find((t) => t.txid === id('bbb'));
    expect(child?.parents).toEqual([id('aaa')]);
  });

  it('says a package of unrelated transactions is not connected', () => {
    const result = simulatePackage({
      candidates: [candidate({ label: 'aaa' }), candidate({ label: 'bbb' })],
      verdicts: ['aaa', 'bbb'].map((label) => verdict({ label })),
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.connected).toBe(false);
  });

  it('separates inputs from the mempool from inputs from nowhere it can see', () => {
    const result = simulatePackage({
      candidates: [candidate({
        label: 'aaa',
        inputs: [{ txid: id('inmempool'), vout: 0 }, { txid: id('confirmed'), vout: 3 }],
      })],
      verdicts: [verdict({ label: 'aaa' })],
      mempool: mempoolOf({ present: [id('inmempool')] }),
      policy: POLICY,
    });
    expect(result.transactions[0].mempoolInputs).toBe(1);
    expect(result.transactions[0].externalInputs).toBe(1);
  });
});

describe('the node verdict is carried through', () => {
  it('is accepted only when every transaction was allowed', () => {
    const result = simulatePackage({
      candidates: [candidate({ label: 'aaa' }), candidate({ label: 'bbb' })],
      verdicts: [
        verdict({ label: 'aaa' }),
        verdict({ label: 'bbb', allowed: false, reason: 'insufficient fee' }),
      ],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.accepted).toBe(false);
    const rejected = result.transactions.find((t) => t.txid === id('bbb'));
    expect(rejected?.rejectReason).toBe('insufficient fee');
  });

  it('is not accepted when the node said nothing about a transaction', () => {
    const result = simulatePackage({
      candidates: [candidate({ label: 'aaa' }), candidate({ label: 'bbb' })],
      verdicts: [verdict({ label: 'aaa' })],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.accepted).toBe(false);
    const silent = result.transactions.find((t) => t.txid === id('bbb'));
    expect(silent?.allowed).toBe(false);
    expect(silent?.rejectReason).toContain('no verdict');
  });

  it('prefers the node virtual size over the decoder one', () => {
    const result = simulatePackage({
      candidates: [candidate({ label: 'aaa', vsize: 100 })],
      verdicts: [verdict({ label: 'aaa', vsize: 142 })],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.transactions[0].vsize).toBe(142);
    expect(result.packageVsize).toBe(142);
  });
});

describe('fees', () => {
  it('takes the fee the node reported', () => {
    const result = simulatePackage({
      candidates: [candidate({ label: 'aaa' })],
      verdicts: [verdict({ label: 'aaa', feeSats: 2500 })],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.transactions[0].feeSats).toBe(2500);
    expect(result.packageFeeSats).toBe(2500);
  });

  it('works one out from the package when the node reported none', () => {
    const result = simulatePackage({
      candidates: [
        candidate({ label: 'aaa', outputs: [9000] }),
        candidate({
          label: 'bbb',
          inputs: [{ txid: id('aaa'), vout: 0 }],
          outputs: [8600],
        }),
      ],
      verdicts: [
        verdict({ label: 'aaa', feeSats: 1000 }),
        verdict({ label: 'bbb', allowed: false, reason: 'insufficient fee', feeSats: null }),
      ],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    const child = result.transactions.find((t) => t.txid === id('bbb'));
    expect(child?.feeSats).toBe(400);
    expect(child?.feeUnknownReason).toBeNull();
  });

  it('works one out from an input the mempool holds', () => {
    const result = simulatePackage({
      candidates: [candidate({
        label: 'aaa',
        inputs: [{ txid: id('parent'), vout: 1 }],
        outputs: [7000],
      })],
      verdicts: [verdict({ label: 'aaa', feeSats: null })],
      mempool: mempoolOf({
        present: [id('parent')],
        outputs: { [`${id('parent')}:1`]: 7300 },
      }),
      policy: POLICY,
    });
    expect(result.transactions[0].feeSats).toBe(300);
  });

  it('leaves the fee unknown rather than treating an unseen input as worthless', () => {
    const result = simulatePackage({
      candidates: [candidate({
        label: 'aaa',
        inputs: [{ txid: id('confirmed'), vout: 0 }],
        outputs: [7000],
      })],
      verdicts: [verdict({ label: 'aaa', feeSats: null })],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.transactions[0].feeSats).toBeNull();
    expect(result.transactions[0].feeUnknownReason).toContain('cannot see');
    expect(result.packageFeeSats).toBeNull();
  });

  it('claims no groups at all while any fee is missing', () => {
    const result = simulatePackage({
      candidates: [
        candidate({ label: 'aaa' }),
        candidate({
          label: 'bbb',
          inputs: [{ txid: id('confirmed'), vout: 0 }],
        }),
      ],
      verdicts: [verdict({ label: 'aaa' }), verdict({ label: 'bbb', feeSats: null })],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    // A group's rate is a sum, and a sum with a hole in it is not a sum.
    expect(result.chunks).toEqual([]);
    expect(result.transactions.every((t) => t.chunkIndex === null)).toBe(true);
  });
});

describe('grouping', () => {
  it('puts a low fee parent and its rich child in one group', () => {
    const result = simulatePackage({
      candidates: [
        candidate({ label: 'aaa', vsize: 100, outputs: [100000] }),
        candidate({ label: 'bbb', vsize: 100, inputs: [{ txid: id('aaa'), vout: 0 }] }),
      ],
      verdicts: [
        verdict({ label: 'aaa', feeSats: 0 }),
        verdict({ label: 'bbb', feeSats: 20000 }),
      ],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].txids).toEqual([id('aaa'), id('bbb')]);
    // 20000 sats over 200 vbytes, which is the rate a miner would see.
    expect(result.chunks[0].feerate).toBeCloseTo(100);
    const parent = result.transactions.find((t) => t.txid === id('aaa'));
    expect(parent?.individualFeerate).toBe(0);
    expect(parent?.effectiveFeerate).toBeCloseTo(100);
  });

  it('reports groups best rate first', () => {
    const result = simulatePackage({
      candidates: [
        candidate({ label: 'aaa', vsize: 100 }),
        candidate({ label: 'bbb', vsize: 100 }),
      ],
      verdicts: [
        verdict({ label: 'aaa', feeSats: 500 }),
        verdict({ label: 'bbb', feeSats: 5000 }),
      ],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.chunks[0].txids).toEqual([id('bbb')]);
    expect(result.chunks[1].txids).toEqual([id('aaa')]);
    const rich = result.transactions.find((t) => t.txid === id('bbb'));
    expect(rich?.chunkIndex).toBe(0);
  });
});

describe('replacement', () => {
  const incumbent: ConflictingTx = { txid: id('old'), feeSats: 1000, vsize: 150 };
  const incumbentChild: ConflictingTx = { txid: id('oldchild'), feeSats: 200, vsize: 110 };

  function conflicting(feeSats: number, vsize = 200) {
    return simulatePackage({
      candidates: [candidate({
        label: 'new',
        vsize,
        inputs: [{ txid: id('funding'), vout: 0 }],
      })],
      verdicts: [verdict({ label: 'new', vsize, feeSats })],
      mempool: mempoolOf({
        spends: { [`${id('funding')}:0`]: incumbent },
        families: { [id('old')]: [incumbent, incumbentChild] },
      }),
      policy: POLICY,
    });
  }

  it('names the transaction in the way and everything descended from it', () => {
    const result = conflicting(5000);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].incumbentTxid).toBe(id('old'));
    expect(result.conflicts[0].outpoint).toBe(`${id('funding')}:0`);
    expect(result.replacement?.evictedTxids).toEqual([id('old'), id('oldchild')]);
    expect(result.replacement?.evictedFeeSats).toBe(1200);
    expect(result.replacement?.evictedVsize).toBe(260);
  });

  it('states the exact fee the replacement has to reach', () => {
    const result = conflicting(5000);
    // Everything it evicts, 1200, plus its own 200 vbytes at 1 sat each.
    expect(result.replacement?.requiredFeeSats).toBe(1400);
    expect(result.replacement?.shortfallSats).toBe(0);
    expect(result.replacement?.satisfiesFeeRules).toBe(true);
  });

  it('states how far short a replacement falls, not merely that it does', () => {
    const result = conflicting(1000);
    expect(result.replacement?.requiredFeeSats).toBe(1400);
    expect(result.replacement?.shortfallSats).toBe(400);
    expect(result.replacement?.satisfiesFeeRules).toBe(false);
  });

  it('rounds the relay cost up, because a node does not accept a part of a satoshi', () => {
    const result = simulatePackage({
      candidates: [candidate({
        label: 'new',
        vsize: 101,
        inputs: [{ txid: id('funding'), vout: 0 }],
      })],
      verdicts: [verdict({ label: 'new', vsize: 101, feeSats: 5000 })],
      mempool: mempoolOf({
        spends: { [`${id('funding')}:0`]: incumbent },
        families: { [id('old')]: [incumbent] },
      }),
      policy: { incrementalRelayFeeSatPerVb: 1.5 },
    });
    // 101 vbytes at 1.5 is 151.5, which costs 152.
    expect(result.replacement?.requiredFeeSats).toBe(1000 + 152);
  });

  it('counts a transaction evicted through two conflicts once', () => {
    const result = simulatePackage({
      candidates: [candidate({
        label: 'new',
        vsize: 200,
        inputs: [{ txid: id('funding'), vout: 0 }, { txid: id('funding'), vout: 1 }],
      })],
      verdicts: [verdict({ label: 'new', vsize: 200, feeSats: 9000 })],
      mempool: mempoolOf({
        spends: {
          [`${id('funding')}:0`]: incumbent,
          [`${id('funding')}:1`]: incumbent,
        },
        families: { [id('old')]: [incumbent] },
      }),
      policy: POLICY,
    });
    expect(result.conflicts).toHaveLength(2);
    expect(result.replacement?.evictedTxids).toEqual([id('old')]);
    expect(result.replacement?.evictedFeeSats).toBe(1000);
  });

  it('refuses the comparison when the package fee is not fully known', () => {
    const result = simulatePackage({
      candidates: [candidate({
        label: 'new',
        vsize: 200,
        inputs: [{ txid: id('funding'), vout: 0 }],
      })],
      verdicts: [verdict({ label: 'new', vsize: 200, feeSats: null })],
      mempool: mempoolOf({
        spends: { [`${id('funding')}:0`]: incumbent },
        families: { [id('old')]: [incumbent] },
      }),
      policy: POLICY,
    });
    expect(result.replacement?.satisfiesFeeRules).toBe(false);
    expect(result.replacement?.incompleteReason).toContain('not known');
    // Zero would read as "it needs nothing more", which is the opposite of true.
    expect(result.replacement?.shortfallSats).toBe(0);
    expect(result.replacement?.incompleteReason).not.toBeNull();
  });

  it('is absent when nothing in the mempool is in the way', () => {
    const result = simulatePackage({
      candidates: [candidate({ label: 'aaa' })],
      verdicts: [verdict({ label: 'aaa' })],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.conflicts).toEqual([]);
    expect(result.replacement).toBeNull();
  });

  it('does not call a package member its own conflict', () => {
    // A child spending its parent's output does not conflict with the parent,
    // even if the mempool has heard of the parent already.
    const result = simulatePackage({
      candidates: [
        candidate({ label: 'aaa', outputs: [9000] }),
        candidate({ label: 'bbb', inputs: [{ txid: id('aaa'), vout: 0 }] }),
      ],
      verdicts: ['aaa', 'bbb'].map((label) => verdict({ label })),
      mempool: mempoolOf({
        spends: { [`${id('aaa')}:0`]: { txid: id('bbb'), feeSats: 1, vsize: 1 } },
      }),
      policy: POLICY,
    });
    expect(result.conflicts).toEqual([]);
  });
});

describe('queuePositionFor', () => {
  const chunks = [
    { feerate: 100, vsize: 1000 },
    { feerate: 50, vsize: 2000 },
    { feerate: 10, vsize: 3000 },
  ];

  it('counts only what pays strictly better', () => {
    const position = queuePositionFor(50, chunks);
    expect(position.vsizeAhead).toBe(1000);
    expect(position.chunksAhead).toBe(1);
  });

  it('does not count an equal rate as ahead', () => {
    // A miner ordering equal rates has no reason to prefer either, and
    // claiming a position would be a guess wearing a number.
    expect(queuePositionFor(100, chunks).vsizeAhead).toBe(1000 - 1000);
  });

  it('puts a rate above everything at the front', () => {
    expect(queuePositionFor(1000, chunks).vsizeAhead).toBe(0);
  });

  it('puts a rate below everything behind all of it', () => {
    expect(queuePositionFor(1, chunks).vsizeAhead).toBe(6000);
    expect(queuePositionFor(1, chunks).chunksAhead).toBe(3);
  });

  it('is reported for the package best group when a mempool is given', () => {
    const result = simulatePackage({
      candidates: [candidate({ label: 'aaa', vsize: 100 })],
      verdicts: [verdict({ label: 'aaa', vsize: 100, feeSats: 2000 })],
      mempool: mempoolOf(),
      policy: POLICY,
      mempoolChunks: chunks,
    });
    // 2000 over 100 vbytes is 20 sat/vB, so the two better groups are ahead.
    expect(result.queuePosition?.feerate).toBeCloseTo(20);
    expect(result.queuePosition?.vsizeAhead).toBe(3000);
  });

  it('is absent when no mempool was given to compare against', () => {
    const result = simulatePackage({
      candidates: [candidate({ label: 'aaa' })],
      verdicts: [verdict({ label: 'aaa' })],
      mempool: mempoolOf(),
      policy: POLICY,
    });
    expect(result.queuePosition).toBeNull();
  });
});
