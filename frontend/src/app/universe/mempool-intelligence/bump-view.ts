import { BumpPlan } from './mempool-intelligence.types';

/**
 * Turning a bump plan into the one thing a reader came for: which route to
 * take, or why neither is open.
 *
 * The plan carries both routes and their prices. Choosing between them is a
 * comparison of two numbers, but only when both are open, and the interesting
 * cases are the ones where they are not.
 */

export type Route = 'replace' | 'child' | 'neither' | 'nothing-to-do';

export interface Recommendation {
  readonly route: Route;
  readonly text: string;
  /** True when a route is open. */
  readonly actionable: boolean;
}

/** Fee rates offered as presets, in satoshis per virtual byte. */
export const TARGET_PRESETS = [1, 2, 5, 10, 20, 50, 100];

/** The lowest and highest a caller may ask for, matching the server. */
export const MIN_TARGET = 1;
export const MAX_TARGET = 10_000;

/**
 * Reads a target rate typed into a box.
 *
 * Refused rather than clamped. Someone who typed 50000 and got a plan for
 * 10000 has been shown a plan for a rate they did not ask for.
 */
export function readTarget(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') { return null; }
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value)) { return null; }
  if (value < MIN_TARGET || value > MAX_TARGET) { return null; }
  // Three decimals is the most a fee rate carries, and the server refuses
  // more, so refusing it here too keeps the two agreeing.
  if (Math.round(value * 1000) !== value * 1000) { return null; }
  return value;
}

/**
 * Says which route to take.
 *
 * When both are open it is the cheaper one, compared on the extra satoshis
 * each costs rather than on the resulting rate: the resulting rates are both
 * the target by construction, so comparing those would compare nothing.
 */
export function recommend(plan: BumpPlan): Recommendation {
  if (plan.alreadyAtTarget) {
    return {
      route: 'nothing-to-do',
      actionable: false,
      text: $localize`:@@mempool.bump.at-target:This transaction already pays at or above the rate you asked for. Replacing it would still cost more, because a replacement has to beat the fee it removes.`,
    };
  }
  const rbf = plan.rbf;
  const cpfp = plan.cpfp;

  if (!rbf.available && !cpfp.available) {
    return {
      route: 'neither',
      actionable: false,
      text: $localize`:@@mempool.bump.neither:Neither route is open. ${rbf.unavailableReason ?? ''} ${cpfp.unavailableReason ?? ''}`,
    };
  }
  if (rbf.available && !cpfp.available) {
    return {
      route: 'replace',
      actionable: true,
      text: $localize`:@@mempool.bump.only-replace:Replace it. A child is not an option here: ${cpfp.unavailableReason ?? ''}`,
    };
  }
  if (!rbf.available && cpfp.available) {
    return {
      route: 'child',
      actionable: true,
      text: $localize`:@@mempool.bump.only-child:Attach a child. Replacing is not an option here: ${rbf.unavailableReason ?? ''}`,
    };
  }
  const cheaper = rbf.additionalFeeSats <= cpfp.requiredChildFeeSats ? 'replace' : 'child';
  const saving = Math.abs(rbf.additionalFeeSats - cpfp.requiredChildFeeSats);
  return {
    route: cheaper,
    actionable: true,
    text: cheaper === 'replace'
      ? $localize`:@@mempool.bump.replace-cheaper:Replacing costs ${rbf.additionalFeeSats} satoshis, which is ${saving} less than a child would.`
      : $localize`:@@mempool.bump.child-cheaper:A child costs ${cpfp.requiredChildFeeSats} satoshis, which is ${saving} less than replacing would.`,
  };
}

/**
 * Warnings that apply whichever route is taken.
 *
 * Each is a fact about the plan, not advice. A dust warning says an output
 * would fall below the line; it does not say what to do about it, because
 * that depends on a wallet this page cannot see.
 */
export function warningsFor(plan: BumpPlan): string[] {
  const warnings: string[] = [];
  if (plan.rbf.available && plan.rbf.outputWouldBecomeDust) {
    warnings.push($localize`:@@mempool.bump.warn-rbf-dust:Taking the extra fee from the largest output would leave ${plan.rbf.outputAfterBumpSats} satoshis, which is below the dust line. A node would refuse the result.`);
  }
  if (plan.cpfp.available && plan.cpfp.changeIsDust) {
    warnings.push($localize`:@@mempool.bump.warn-child-dust:A child paying that fee would have ${plan.cpfp.changeSats} satoshis left, which is below the dust line. It would need a second input.`);
  }
  if (plan.rbf.available && plan.rbf.evictedTxids.length) {
    warnings.push($localize`:@@mempool.bump.warn-evict:Replacing this removes ${plan.rbf.evictedTxids.length} transactions that spend from it. They would have to be made again.`);
  }
  if (plan.rbf.available && plan.rbf.boundByReplacementRules) {
    warnings.push($localize`:@@mempool.bump.warn-bound:The replacement rules set this price, not the rate you asked for. Asking for a lower rate would not make it cheaper.`);
  }
  return warnings;
}
