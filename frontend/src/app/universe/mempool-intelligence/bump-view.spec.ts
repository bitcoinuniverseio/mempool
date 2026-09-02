import { describe, expect, it } from 'vitest';
import { MAX_TARGET, readTarget, recommend, warningsFor } from './bump-view';
import { BumpPlan, CpfpPlan, RbfPlan } from './mempool-intelligence.types';

function rbf(options: Partial<RbfPlan> = {}): RbfPlan {
  return {
    available: true,
    unavailableReason: null,
    requiredFeeSats: 4000,
    additionalFeeSats: 3000,
    resultingFeerate: 20,
    evictedTxids: [],
    evictedFeeSats: 1000,
    boundByReplacementRules: false,
    largestOutputSats: 100_000,
    outputAfterBumpSats: 97_000,
    outputWouldBecomeDust: false,
    ...options,
  };
}

function cpfp(options: Partial<CpfpPlan> = {}): CpfpPlan {
  return {
    available: true,
    unavailableReason: null,
    spendOutputIndex: 0,
    spendValueSats: 100_000,
    childVsize: 110,
    requiredChildFeeSats: 5200,
    changeSats: 94_800,
    changeIsDust: false,
    resultingPackageFeerate: 20,
    ...options,
  };
}

function plan(options: Partial<BumpPlan> = {}): BumpPlan {
  return {
    txid: 'a'.repeat(64),
    currentFeeSats: 1000,
    currentFeerate: 5,
    targetFeerate: 20,
    rbf: rbf(),
    cpfp: cpfp(),
    alreadyAtTarget: false,
    outputsToCheckForAssets: [0],
    ...options,
  };
}

describe('readTarget', () => {
  it('takes a whole rate and a fractional one', () => {
    expect(readTarget('20')).toBe(20);
    expect(readTarget(1.5)).toBe(1.5);
    expect(readTarget(' 12 ')).toBe(12);
  });

  it('refuses an empty box rather than picking a rate', () => {
    expect(readTarget('')).toBeNull();
    expect(readTarget(null)).toBeNull();
    expect(readTarget(undefined)).toBeNull();
  });

  it('refuses a rate below one and above the ceiling, without clamping', () => {
    // Clamping would show a plan for a rate nobody asked for.
    expect(readTarget('0.5')).toBeNull();
    expect(readTarget(String(MAX_TARGET))).toBe(MAX_TARGET);
    expect(readTarget(String(MAX_TARGET + 1))).toBeNull();
  });

  it('refuses text and more precision than a fee rate carries', () => {
    expect(readTarget('fast')).toBeNull();
    expect(readTarget('1.23456')).toBeNull();
  });
});

describe('recommend', () => {
  it('takes the cheaper of two open routes', () => {
    const answer = recommend(plan());
    // 3000 to replace against 5200 for a child.
    expect(answer.route).toBe('replace');
    expect(answer.actionable).toBe(true);
    expect(answer.text).toContain('3000');
  });

  it('takes the child when the child is cheaper', () => {
    const answer = recommend(plan({
      rbf: rbf({ additionalFeeSats: 9000 }),
      cpfp: cpfp({ requiredChildFeeSats: 5200 }),
    }));
    expect(answer.route).toBe('child');
    expect(answer.text).toContain('5200');
  });

  it('compares the extra cost rather than the resulting rate', () => {
    // Both routes reach the target by construction, so comparing the
    // resulting rates would compare two equal numbers.
    const answer = recommend(plan({
      rbf: rbf({ additionalFeeSats: 100, resultingFeerate: 20 }),
      cpfp: cpfp({ requiredChildFeeSats: 99, resultingPackageFeerate: 20 }),
    }));
    expect(answer.route).toBe('child');
  });

  it('prefers replacing when the two cost exactly the same', () => {
    const answer = recommend(plan({
      rbf: rbf({ additionalFeeSats: 5000 }),
      cpfp: cpfp({ requiredChildFeeSats: 5000 }),
    }));
    expect(answer.route).toBe('replace');
  });

  it('names the one open route and why the other is closed', () => {
    const answer = recommend(plan({
      cpfp: cpfp({ available: false, unavailableReason: 'Every output is already spent.' }),
    }));
    expect(answer.route).toBe('replace');
    expect(answer.text).toContain('already spent');
  });

  it('names the child route when replacing is closed', () => {
    const answer = recommend(plan({
      rbf: rbf({ available: false, unavailableReason: 'Nothing signalled.' }),
    }));
    expect(answer.route).toBe('child');
    expect(answer.text).toContain('Nothing signalled');
  });

  it('carries both reasons when neither route is open', () => {
    const answer = recommend(plan({
      rbf: rbf({ available: false, unavailableReason: 'Nothing signalled.' }),
      cpfp: cpfp({ available: false, unavailableReason: 'Every output is spent.' }),
    }));
    expect(answer.route).toBe('neither');
    expect(answer.actionable).toBe(false);
    expect(answer.text).toContain('Nothing signalled');
    expect(answer.text).toContain('Every output is spent');
  });

  it('says there is nothing to do when the rate is already met', () => {
    const answer = recommend(plan({ alreadyAtTarget: true }));
    expect(answer.route).toBe('nothing-to-do');
    expect(answer.actionable).toBe(false);
    // And says why replacing is still not free, which is the surprising part.
    expect(answer.text).toContain('beat the fee it removes');
  });
});

describe('warningsFor', () => {
  it('warns when the extra fee would leave dust', () => {
    const warnings = warningsFor(plan({
      rbf: rbf({ outputWouldBecomeDust: true, outputAfterBumpSats: 100 }),
    }));
    expect(warnings.some((w) => w.includes('100') && w.includes('dust'))).toBe(true);
  });

  it('warns when a child would be left with dust', () => {
    const warnings = warningsFor(plan({
      cpfp: cpfp({ changeIsDust: true, changeSats: 200 }),
    }));
    expect(warnings.some((w) => w.includes('second input'))).toBe(true);
  });

  it('warns that a replacement takes its children with it', () => {
    const warnings = warningsFor(plan({
      rbf: rbf({ evictedTxids: ['b'.repeat(64), 'c'.repeat(64)] }),
    }));
    expect(warnings.some((w) => w.includes('2 transactions'))).toBe(true);
  });

  it('warns when a lower target would not make it cheaper', () => {
    const warnings = warningsFor(plan({ rbf: rbf({ boundByReplacementRules: true }) }));
    expect(warnings.some((w) => w.includes('lower rate'))).toBe(true);
  });

  it('stays silent about a route that is closed', () => {
    // A dust warning about a replacement nobody can make is noise.
    const warnings = warningsFor(plan({
      rbf: rbf({ available: false, outputWouldBecomeDust: true, evictedTxids: ['b'.repeat(64)] }),
      cpfp: cpfp({ available: false, changeIsDust: true }),
    }));
    expect(warnings).toEqual([]);
  });

  it('says nothing when there is nothing to warn about', () => {
    expect(warningsFor(plan())).toEqual([]);
  });
});
