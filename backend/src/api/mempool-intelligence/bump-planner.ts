/**
 * What it would cost to make an unconfirmed transaction confirm sooner.
 *
 * There are two ways, and which of them is open is not a matter of taste. A
 * replacement needs the node to accept one and needs to outbid everything it
 * evicts. A child needs an output of the transaction that nobody has spent
 * yet and whose spend size can be worked out. Either can be closed, and when
 * one is, saying why is the useful part.
 *
 * Nothing here builds or signs a transaction. It produces the numbers a
 * wallet needs and stops there, because the moment this code could produce a
 * signature is the moment its promise depends on it choosing not to.
 */

/** Any input below this sequence signals that the sender allows replacement. */
export const REPLACEMENT_SIGNAL_SEQUENCE = 0xfffffffe;

export type SpendableType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2wsh' | 'p2tr' | 'unknown';

export interface BumpOutput {
  readonly index: number;
  readonly valueSats: number;
  readonly type: SpendableType;
  /** True when something in the mempool already spends this output. */
  readonly spent: boolean;
}

export interface BumpDescendant {
  readonly txid: string;
  readonly feeSats: number;
  readonly vsize: number;
}

export interface BumpTarget {
  readonly txid: string;
  /** The size the mining code charges, which is the size every rate uses. */
  readonly vsize: number;
  readonly weight: number;
  readonly feeSats: number;
  /** True when at least one input sets a sequence below the signal. */
  readonly signalsReplacement: boolean;
  readonly outputs: readonly BumpOutput[];
  /** Unconfirmed ancestors, which a miner takes along with this transaction. */
  readonly ancestorVsize: number;
  readonly ancestorFeeSats: number;
  /** Everything descended from it, which a replacement would evict. */
  readonly descendants: readonly BumpDescendant[];
}

export interface BumpPolicy {
  readonly incrementalRelayFeeSatPerVb: number;
  /** True when this node accepts a replacement that never signalled for one. */
  readonly fullReplacementEnabled: boolean;
}

/**
 * Below these values an output is refused as dust.
 *
 * The threshold is a property of the output's own script, not of the
 * transaction, because it is the cost of spending that output at the dust
 * relay rate. A single number for all of them would call a valid Taproot
 * output dust or let a too small legacy one through.
 *
 * An output whose type is not recognised takes the largest of the standard
 * thresholds. Being wrong in the direction of a warning nobody needed is
 * better than being wrong in the direction of silence.
 */
export const DUST_THRESHOLD: Record<SpendableType, number> = {
  p2pkh: 546,
  'p2sh-p2wpkh': 540,
  p2wpkh: 294,
  p2wsh: 330,
  p2tr: 330,
  unknown: 546,
};

export interface RbfPlan {
  readonly available: boolean;
  readonly unavailableReason: string | null;
  /** What the replacement has to pay in total. */
  readonly requiredFeeSats: number;
  /** How much more than the transaction pays now. */
  readonly additionalFeeSats: number;
  /** The rate the replacement would end up at, which can exceed the target. */
  readonly resultingFeerate: number;
  readonly evictedTxids: readonly string[];
  readonly evictedFeeSats: number;
  /**
   * True when the replacement rules, not the target rate, set the price. The
   * distinction matters: asking for a lower target would not make it cheaper.
   */
  readonly boundByReplacementRules: boolean;
  /**
   * The largest output, reduced by the extra fee, and whether that leaves
   * dust. A replacement usually takes the extra fee from one output, and an
   * output pushed under the dust line makes the whole thing unrelayable.
   */
  readonly largestOutputSats: number | null;
  readonly outputAfterBumpSats: number | null;
  readonly outputWouldBecomeDust: boolean;
}

export interface CpfpPlan {
  readonly available: boolean;
  readonly unavailableReason: string | null;
  /** The output a child would spend, chosen as the largest one it can. */
  readonly spendOutputIndex: number | null;
  readonly spendValueSats: number | null;
  /** The child's size, worked out from the output type it spends. */
  readonly childVsize: number | null;
  readonly requiredChildFeeSats: number;
  /** What the child would have left to pay out after its fee. */
  readonly changeSats: number | null;
  readonly changeIsDust: boolean;
  /** The rate a miner would see for the whole group. */
  readonly resultingPackageFeerate: number;
}

export interface BumpPlan {
  readonly txid: string;
  readonly currentFeeSats: number;
  readonly currentFeerate: number;
  readonly targetFeerate: number;
  readonly rbf: RbfPlan;
  readonly cpfp: CpfpPlan;
  /** True when the target is at or below what the transaction already pays. */
  readonly alreadyAtTarget: boolean;
  /**
   * Outputs a reader should check for protocol assets before spending. Every
   * output is listed: this process reads the base chain only, so it cannot
   * say which of them carry anything, and naming a subset would imply it can.
   */
  readonly outputsToCheckForAssets: readonly number[];
}

/**
 * The virtual size of a one input, one output transaction spending each type.
 *
 * A spend's size is fixed by the type only where the type fixes the script.
 * For a bare script hash it is not: the spend depends on a script the node
 * has not seen, so no size is given rather than a plausible one.
 */
const CHILD_VSIZE: Partial<Record<SpendableType, number>> = {
  // 10.5 overhead, 148 input, 34 output.
  p2pkh: 193,
  // 10.5 overhead, 91 input, 32 output.
  'p2sh-p2wpkh': 134,
  // 10.5 overhead, 68 input, 31 output.
  p2wpkh: 110,
  // 10.5 overhead, 57.5 key path input, 43 output.
  p2tr: 111,
};

/** True when an input sequence allows a replacement of the transaction. */
export function signalsReplacement(sequences: readonly number[]): boolean {
  return sequences.some((sequence) => sequence < REPLACEMENT_SIGNAL_SEQUENCE);
}

function plansRbf(
  target: BumpTarget,
  policy: BumpPolicy,
  targetFeerate: number,
): RbfPlan {
  const evictedFeeSats = target.feeSats
    + target.descendants.reduce((sum, tx) => sum + tx.feeSats, 0);
  const evictedTxids = target.descendants.map((tx) => tx.txid).sort();

  // The two floors. The replacement rules say a replacement must beat every
  // fee it removes and pay its own relay cost on top. The target says it must
  // reach a rate. Whichever is higher is the price.
  const rulesFloor = evictedFeeSats + Math.ceil(policy.incrementalRelayFeeSatPerVb * target.vsize);
  const targetFloor = Math.ceil(targetFeerate * target.vsize);
  const requiredFeeSats = Math.max(rulesFloor, targetFloor);
  const additionalFeeSats = Math.max(0, requiredFeeSats - target.feeSats);

  const largest = target.outputs.reduce<BumpOutput | null>(
    (best, output) => (best === null || output.valueSats > best.valueSats ? output : best),
    null,
  );
  const largestOutputSats = largest ? largest.valueSats : null;
  const outputAfterBumpSats = largestOutputSats === null
    ? null
    : largestOutputSats - additionalFeeSats;

  let unavailableReason: string | null = null;
  if (!target.signalsReplacement && !policy.fullReplacementEnabled) {
    unavailableReason = 'No input on this transaction signalled that it may be replaced, and this node does not accept unsignalled replacements.';
  } else if (outputAfterBumpSats !== null && outputAfterBumpSats < 0) {
    unavailableReason = 'The extra fee is larger than the biggest output, so it cannot come from this transaction alone. A replacement would have to add an input.';
  }

  return {
    available: unavailableReason === null,
    unavailableReason,
    requiredFeeSats,
    additionalFeeSats,
    resultingFeerate: target.vsize > 0 ? requiredFeeSats / target.vsize : 0,
    evictedTxids,
    evictedFeeSats,
    boundByReplacementRules: rulesFloor > targetFloor,
    largestOutputSats,
    outputAfterBumpSats,
    outputWouldBecomeDust: outputAfterBumpSats !== null
      && outputAfterBumpSats >= 0
      && largest !== null
      && outputAfterBumpSats < DUST_THRESHOLD[largest.type],
  };
}

function plansCpfp(
  target: BumpTarget,
  policy: BumpPolicy,
  targetFeerate: number,
): CpfpPlan {
  const empty = {
    spendOutputIndex: null,
    spendValueSats: null,
    childVsize: null,
    requiredChildFeeSats: 0,
    changeSats: null,
    changeIsDust: false,
    resultingPackageFeerate: 0,
  };

  const spendable = target.outputs.filter(
    (output) => !output.spent && CHILD_VSIZE[output.type] !== undefined,
  );
  if (!spendable.length) {
    const anyUnspent = target.outputs.some((output) => !output.spent);
    return {
      ...empty,
      available: false,
      unavailableReason: anyUnspent
        ? 'Every unspent output here pays to a script whose spend size depends on a script this node has not seen, so the cost of a child cannot be worked out.'
        : 'Every output of this transaction is already spent in the mempool. A child would have to be attached to one of those instead.',
    };
  }

  // The largest, because the child has to cover its own fee out of what it
  // spends and the largest output is the one most likely to.
  const chosen = spendable.reduce((best, output) =>
    (output.valueSats > best.valueSats ? output : best));
  const childVsize = CHILD_VSIZE[chosen.type] as number;

  // A miner takes the whole ancestor set at one rate, so the group is this
  // transaction, everything unconfirmed above it, and the child.
  const groupVsize = target.ancestorVsize + childVsize;
  const groupFeeAlready = target.ancestorFeeSats;
  const requiredChildFeeSats = Math.max(
    0,
    Math.ceil(targetFeerate * groupVsize) - groupFeeAlready,
  );
  const changeSats = chosen.valueSats - requiredChildFeeSats;

  let unavailableReason: string | null = null;
  if (changeSats < 0) {
    unavailableReason = 'The output a child would spend is worth less than the fee that child has to pay, so a child alone cannot reach this rate.';
  }

  return {
    available: unavailableReason === null,
    unavailableReason,
    spendOutputIndex: chosen.index,
    spendValueSats: chosen.valueSats,
    childVsize,
    requiredChildFeeSats,
    changeSats,
    changeIsDust: changeSats >= 0 && changeSats < DUST_THRESHOLD[chosen.type],
    resultingPackageFeerate: groupVsize > 0
      ? (groupFeeAlready + requiredChildFeeSats) / groupVsize
      : 0,
  };
}

/**
 * Both routes to a higher fee rate, priced.
 */
export function planBump(
  target: BumpTarget,
  policy: BumpPolicy,
  targetFeerate: number,
): BumpPlan {
  const currentFeerate = target.vsize > 0 ? target.feeSats / target.vsize : 0;
  return {
    txid: target.txid,
    currentFeeSats: target.feeSats,
    currentFeerate,
    targetFeerate,
    rbf: plansRbf(target, policy, targetFeerate),
    cpfp: plansCpfp(target, policy, targetFeerate),
    alreadyAtTarget: currentFeerate >= targetFeerate,
    outputsToCheckForAssets: target.outputs.map((output) => output.index),
  };
}
