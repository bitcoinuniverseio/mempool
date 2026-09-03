import {
  planBump,
  signalsReplacement,
  type BumpOutput,
  type BumpPolicy,
  type BumpTarget,
} from '../api/mempool-intelligence/bump-planner';

function id(label: string): string {
  return label.padEnd(64, '0');
}

const POLICY: BumpPolicy = {
  incrementalRelayFeeSatPerVb: 1,
  fullReplacementEnabled: true,

};

function output(options: Partial<BumpOutput> = {}): BumpOutput {
  return { index: 0, valueSats: 100_000, type: 'p2wpkh', spent: false, ...options };
}

function target(options: Partial<BumpTarget> = {}): BumpTarget {
  const vsize = options.vsize ?? 200;
  return {
    txid: id('a'),
    vsize,
    weight: vsize * 4,
    feeSats: 1000,
    signalsReplacement: true,
    outputs: [output()],
    ancestorVsize: vsize,
    ancestorFeeSats: options.feeSats ?? 1000,
    descendants: [],
    ...options,
  };
}

describe('signalsReplacement', () => {
  it('is true when any input sits below the signal', () => {
    expect(signalsReplacement([0xffffffff, 0xfffffffd])).toBe(true);
  });

  it('is false when every input is at or above it', () => {
    expect(signalsReplacement([0xffffffff, 0xfffffffe])).toBe(false);
  });

  it('is false for a transaction with no inputs at all', () => {
    expect(signalsReplacement([])).toBe(false);
  });
});

describe('the replacement route', () => {
  it('prices a straightforward bump at the target rate', () => {
    // 200 vbytes at 20 sat/vB is 4000, and it pays 1000 already.
    const plan = planBump(target(), POLICY, 20);
    expect(plan.rbf.available).toBe(true);
    expect(plan.rbf.requiredFeeSats).toBe(4000);
    expect(plan.rbf.additionalFeeSats).toBe(3000);
    expect(plan.rbf.resultingFeerate).toBeCloseTo(20);
  });

  it('charges for everything it evicts when that costs more than the target', () => {
    const plan = planBump(target({
      descendants: [
        { txid: id('b'), feeSats: 9000, vsize: 150 },
        { txid: id('c'), feeSats: 500, vsize: 110 },
      ],
    }), POLICY, 20);
    // Evicted is 1000 + 9000 + 500, plus 200 vbytes of relay at 1 sat each.
    expect(plan.rbf.requiredFeeSats).toBe(10700);
    expect(plan.rbf.boundByReplacementRules).toBe(true);
    expect(plan.rbf.evictedTxids).toEqual([id('b'), id('c')]);
    expect(plan.rbf.evictedFeeSats).toBe(10500);
  });

  it('says when the target rather than the rules sets the price', () => {
    // Asking for a lower target would make this cheaper, which is not true
    // in the case above, and the flag is what tells them apart.
    const plan = planBump(target(), POLICY, 100);
    expect(plan.rbf.boundByReplacementRules).toBe(false);
  });

  it('rounds the relay cost up, since a node takes no part of a satoshi', () => {
    const plan = planBump(
      target({ vsize: 101, descendants: [{ txid: id('b'), feeSats: 100, vsize: 100 }] }),
      { ...POLICY, incrementalRelayFeeSatPerVb: 1.5 },
      1,
    );
    // 1100 evicted plus ceil(101 * 1.5) = 152.
    expect(plan.rbf.requiredFeeSats).toBe(1252);
  });

  it('is closed when nothing signalled and the node refuses unsignalled ones', () => {
    const plan = planBump(
      target({ signalsReplacement: false }),
      { ...POLICY, fullReplacementEnabled: false },
      20,
    );
    expect(plan.rbf.available).toBe(false);
    expect(plan.rbf.unavailableReason).toContain('signalled');
  });

  it('is open when nothing signalled but the node replaces anyway', () => {
    const plan = planBump(target({ signalsReplacement: false }), POLICY, 20);
    expect(plan.rbf.available).toBe(true);
  });

  it('says so when the extra fee exceeds the biggest output', () => {
    const plan = planBump(target({ outputs: [output({ valueSats: 2000 })] }), POLICY, 100);
    // 200 vbytes at 100 is 20000, and the only output holds 2000.
    expect(plan.rbf.available).toBe(false);
    expect(plan.rbf.unavailableReason).toContain('add an input');
  });

  it('warns when the bump would push an output under the dust line', () => {
    const plan = planBump(target({ outputs: [output({ valueSats: 4200 })] }), POLICY, 20);
    // 4200 less the 3000 extra leaves 1200, which is above dust.
    expect(plan.rbf.outputWouldBecomeDust).toBe(false);
    const tighter = planBump(target({ outputs: [output({ valueSats: 3100 })] }), POLICY, 20);
    // 3100 less 3000 leaves 100, which is below it.
    expect(tighter.rbf.outputAfterBumpSats).toBe(100);
    expect(tighter.rbf.outputWouldBecomeDust).toBe(true);
  });

  it('takes the largest output as the one the extra fee comes from', () => {
    const plan = planBump(target({
      outputs: [
        output({ index: 0, valueSats: 500 }),
        output({ index: 1, valueSats: 90_000 }),
      ],
    }), POLICY, 20);
    expect(plan.rbf.largestOutputSats).toBe(90_000);
    expect(plan.rbf.outputAfterBumpSats).toBe(87_000);
  });

  it('still charges to replace a transaction that already pays the target', () => {
    // A replacement has to beat the fee it removes whatever the target says,
    // so this is not free. It is 200 satoshis of relay cost for no gain,
    // which is what `alreadyAtTarget` is on the plan to tell a reader.
    const plan = planBump(target({ feeSats: 8000 }), POLICY, 20);
    expect(plan.alreadyAtTarget).toBe(true);
    expect(plan.rbf.additionalFeeSats).toBe(200);
    expect(plan.rbf.boundByReplacementRules).toBe(true);
  });
});

describe('the child route', () => {
  it('prices a child that lifts the whole group to the target', () => {
    const plan = planBump(target(), POLICY, 20);
    // The group is 200 ancestor vbytes plus a 110 vbyte child, so 310 at 20
    // is 6200, and 1000 is already paid.
    expect(plan.cpfp.available).toBe(true);
    expect(plan.cpfp.childVsize).toBe(110);
    expect(plan.cpfp.requiredChildFeeSats).toBe(5200);
    expect(plan.cpfp.resultingPackageFeerate).toBeCloseTo(20);
  });

  it('sizes the child from the output type it would spend', () => {
    expect(planBump(target({ outputs: [output({ type: 'p2tr' })] }), POLICY, 20).cpfp.childVsize)
      .toBe(111);
    expect(planBump(target({ outputs: [output({ type: 'p2pkh' })] }), POLICY, 20).cpfp.childVsize)
      .toBe(193);
    expect(planBump(target({ outputs: [output({ type: 'p2sh-p2wpkh' })] }), POLICY, 20).cpfp.childVsize)
      .toBe(134);
  });

  it('counts the unconfirmed ancestors, which a miner takes along too', () => {
    const plan = planBump(target({
      vsize: 200,
      feeSats: 1000,
      ancestorVsize: 500,
      ancestorFeeSats: 1500,
    }), POLICY, 20);
    // 500 plus 110 is 610 vbytes at 20 is 12200, less the 1500 already paid.
    expect(plan.cpfp.requiredChildFeeSats).toBe(10700);
  });

  it('refuses to size a child for an output whose spend it cannot predict', () => {
    // A bare script hash spend depends on a script the node has not seen, so
    // any figure here would be invented.
    const plan = planBump(target({ outputs: [output({ type: 'p2wsh' })] }), POLICY, 20);
    expect(plan.cpfp.available).toBe(false);
    expect(plan.cpfp.unavailableReason).toContain('has not seen');
    expect(plan.cpfp.childVsize).toBeNull();
  });

  it('says when every output is already spent', () => {
    const plan = planBump(target({ outputs: [output({ spent: true })] }), POLICY, 20);
    expect(plan.cpfp.available).toBe(false);
    expect(plan.cpfp.unavailableReason).toContain('already spent');
  });

  it('skips a spent output and uses one that is free', () => {
    const plan = planBump(target({
      outputs: [
        output({ index: 0, valueSats: 500_000, spent: true }),
        output({ index: 1, valueSats: 90_000, spent: false }),
      ],
    }), POLICY, 20);
    expect(plan.cpfp.spendOutputIndex).toBe(1);
  });

  it('picks the largest spendable output', () => {
    const plan = planBump(target({
      outputs: [
        output({ index: 0, valueSats: 1000 }),
        output({ index: 1, valueSats: 90_000 }),
      ],
    }), POLICY, 20);
    expect(plan.cpfp.spendOutputIndex).toBe(1);
    expect(plan.cpfp.spendValueSats).toBe(90_000);
  });

  it('is closed when the output is worth less than the fee the child must pay', () => {
    const plan = planBump(target({ outputs: [output({ valueSats: 400 })] }), POLICY, 20);
    expect(plan.cpfp.available).toBe(false);
    expect(plan.cpfp.unavailableReason).toContain('worth less than the fee');
    expect(plan.cpfp.changeSats).toBeLessThan(0);
  });

  it('warns when the child would be left with dust', () => {
    // 5200 is required, so an output of 5400 leaves 200, under the line.
    const plan = planBump(target({ outputs: [output({ valueSats: 5400 })] }), POLICY, 20);
    expect(plan.cpfp.changeSats).toBe(200);
    expect(plan.cpfp.changeIsDust).toBe(true);
  });

  it('asks for nothing when the group already pays the target', () => {
    const plan = planBump(target({ feeSats: 20_000, ancestorFeeSats: 20_000 }), POLICY, 20);
    expect(plan.cpfp.requiredChildFeeSats).toBe(0);
  });
});

describe('the plan as a whole', () => {
  it('reports the rate the transaction pays now', () => {
    const plan = planBump(target({ vsize: 200, feeSats: 1000 }), POLICY, 20);
    expect(plan.currentFeerate).toBeCloseTo(5);
  });

  it('lists every output for an asset check, not a chosen few', () => {
    // This process reads the base chain only. Naming a subset would imply it
    // knows which outputs carry something, and it does not.
    const plan = planBump(target({
      outputs: [output({ index: 0 }), output({ index: 1 }), output({ index: 2 })],
    }), POLICY, 20);
    expect(plan.outputsToCheckForAssets).toEqual([0, 1, 2]);
  });

  it('handles a transaction with no outputs without dividing by nothing', () => {
    const plan = planBump(target({ outputs: [] }), POLICY, 20);
    expect(plan.rbf.largestOutputSats).toBeNull();
    expect(plan.cpfp.available).toBe(false);
    expect(Number.isFinite(plan.rbf.resultingFeerate)).toBe(true);
  });
});
