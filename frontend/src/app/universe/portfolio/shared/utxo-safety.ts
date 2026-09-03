/**
 * UTXO safety classification and effective-value economics.
 *
 * Pure, deterministic, and read-only: a local flag or heuristic never
 * presents itself as an on-chain lock, and "safe to spend" is never
 * claimed while any required protocol authority is unavailable, outside
 * coverage, stale, or unresolved.
 */

import type { PortfolioUtxo } from '@app/shared/universe-portfolio-v2.types';

export type UtxoSafetyClass =
  | 'asset-bearing'
  | 'plain-proven'
  | 'plain-partial'
  | 'unknown-asset-state'
  | 'economic-dust'
  | 'low-effective-value'
  | 'pending'
  | 'immature-coinbase'
  | 'time-locked'
  | 'spent'
  | 'reorged';

/** Per-1000-vbyte input weight by script type, in virtual bytes. */
export const INPUT_VBYTES: Readonly<Record<string, number>> = {
  p2wpkh: 57.25,
  'p2sh-p2wpkh': 90.75,
  p2pkh: 147.5,
  p2tr: 57.25,
  unknown: 147.5,
};

export interface EffectiveValueResult {
  readonly inputCostAtomic: string;
  readonly effectiveValueAtomic: string;
  readonly feeToValueRatio: string | null;
  readonly economic: boolean;
  readonly breakEvenFeeRateSatVb: string;
}

/**
 * The economics of spending one output at a fee rate. The assumed input
 * weight is stated per script type; estimates stay distinct from the
 * protocol value, which is exact.
 */
export function effectiveValue(
  valueAtomic: string,
  scriptType: string,
  feeRateSatPerVb: string,
): EffectiveValueResult | null {
  if (!/^\d+(\.\d+)?$/.test(valueAtomic) || !/^\d+(\.\d+)?$/.test(feeRateSatPerVb)) {
    return null;
  }
  const vbytes = INPUT_VBYTES[scriptType] ?? INPUT_VBYTES['unknown'];
  const rate = Number(feeRateSatPerVb);
  if (!Number.isFinite(rate) || rate < 0) return null;
  // The input cost is the input's fee weight times the rate - independent
  // of how many satoshis the output carries.
  const costExact = exactMultiplyRoundUp(String(vbytes), feeRateSatPerVb);
  const cost = BigInt(costExact);
  const value = BigInt(valueAtomic);
  const effective = value > cost ? value - cost : 0n;
  const ratio = value === 0n ? null : exactRatio(cost, value);
  const breakEven = value === 0n ? '0' : exactDivide(value, vbytes);
  return {
    inputCostAtomic: cost.toString(),
    effectiveValueAtomic: effective.toString(),
    feeToValueRatio: ratio,
    economic: effective > 0n,
    breakEvenFeeRateSatVb: breakEven,
  };
}

export interface UtxoClassification {
  readonly classes: readonly UtxoSafetyClass[];
  readonly primary: UtxoSafetyClass;
  readonly warnings: readonly string[];
}

const WARNING_CLASS_HINTS: readonly { hint: string; warnClass: UtxoSafetyClass }[] = [
  { hint: 'coinbase state is unproven', warnClass: 'unknown-asset-state' },
  { hint: 'composition is not proven', warnClass: 'unknown-asset-state' },
  { hint: 'asset composition is unknown', warnClass: 'unknown-asset-state' },
];

/**
 * Classifies one UTXO. A UTXO may carry several non-exclusive classes;
 * `primary` is the most consequential one for presentation.
 */
export function classifyUtxo(
  utxo: PortfolioUtxo,
  options: { readonly dustThresholdAtomic?: string } = {},
): UtxoClassification {
  const classes = new Set<UtxoSafetyClass>();
  if (utxo.pending) classes.add('pending');
  if (utxo.spent) classes.add('spent');
  if (utxo.coinbase && utxo.maturityHeightAtomic !== null && !utxo.pending) {
    classes.add('immature-coinbase');
  }
  if (utxo.assets.length > 0) {
    classes.add('asset-bearing');
  }
  if (utxo.assetState === 'partial' || utxo.assetState === 'unavailable' || utxo.assetState === 'unsupported') {
    classes.add('unknown-asset-state');
  } else if (utxo.assetState === 'stale') {
    classes.add('unknown-asset-state');
  }
  for (const warning of utxo.warnings) {
    for (const { hint, warnClass } of WARNING_CLASS_HINTS) {
      if (warning.includes(hint)) classes.add(warnClass);
    }
  }
  const dust = options.dustThresholdAtomic;
  if (dust !== undefined && /^\d+$/.test(dust) && BigInt(utxo.valueAtomic) <= BigInt(dust)) {
    classes.add('economic-dust');
  }
  if (classes.size === 0) {
    classes.add(
      utxo.assetState === 'proven' && utxo.assets.length === 0
        ? 'plain-proven'
        : 'plain-partial',
    );
  }
  const order: readonly UtxoSafetyClass[] = [
    'reorged', 'spent', 'immature-coinbase', 'pending', 'time-locked',
    'asset-bearing', 'unknown-asset-state', 'economic-dust',
    'low-effective-value', 'plain-partial', 'plain-proven',
  ];
  let primary: UtxoSafetyClass = 'unknown-asset-state';
  for (const candidate of order) {
    if (classes.has(candidate)) {
      primary = candidate;
      break;
    }
  }
  return {
    classes: [...classes].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    primary,
    warnings: utxo.warnings,
  };
}

/**
 * Informational consolidation analysis over proven plain-BTC outputs.
 * Estimates only; nothing here builds or signs anything.
 */
export interface ConsolidationAnalysis {
  readonly candidateCount: number;
  readonly totalValueAtomic: string;
  readonly currentFeeAtomic: string;
  readonly alternativeFees: readonly { readonly rateSatVb: string; readonly feeAtomic: string }[];
  readonly futureInputSavingsAtomic: string;
  readonly resultingUtxoCount: number;
  readonly excluded: readonly { readonly outpoint: string; readonly reason: string }[];
}

export function analyzeConsolidation(
  utxos: readonly PortfolioUtxo[],
  currentRateSatVb: string,
  alternativeRatesSatVb: readonly string[],
): ConsolidationAnalysis {
  const candidates = utxos.filter((utxo) => {
    const classification = classifyUtxo(utxo);
    return classification.primary === 'plain-proven';
  });
  const excluded = utxos
    .filter((utxo) => !candidates.includes(utxo))
    .map((utxo) => {
      const classification = classifyUtxo(utxo);
      return {
        outpoint: `${utxo.txid}:${utxo.vout}`,
        reason:
          classification.primary === 'asset-bearing'
            ? 'Asset-bearing outputs are never candidates.'
            : classification.primary === 'unknown-asset-state'
              ? 'The asset state is not proven.'
              : classification.primary === 'economic-dust'
                ? 'The output is below the dust threshold.'
                : 'The output is pending, spent, or otherwise not spendable now.',
      };
    });
  const total = candidates.reduce((sum, utxo) => sum + BigInt(utxo.valueAtomic), 0n);
  const feeAt = (rate: string): string => {
    const vbytes = candidates.reduce((sum, utxo) => sum + (INPUT_VBYTES[utxo.scriptType] ?? INPUT_VBYTES['unknown']), 0);
    const outputVbytes = 31;
    const txVbytes = vbytes + outputVbytes;
    return exactMultiplyRoundUp(txVbytes.toFixed(0), rate);
  };
  const currentFee = BigInt(feeAt(currentRateSatVb));
  const futureSavings = candidates.reduce((savings, utxo) => {
    const perInput = Number(INPUT_VBYTES[utxo.scriptType] ?? INPUT_VBYTES['unknown']) * Number(currentRateSatVb);
    return savings + BigInt(Math.ceil(perInput));
  }, 0n);
  return {
    candidateCount: candidates.length,
    totalValueAtomic: total.toString(),
    currentFeeAtomic: currentFee.toString(),
    alternativeFees: alternativeRatesSatVb.map((rate) => ({ rateSatVb: rate, feeAtomic: feeAt(rate) })),
    futureInputSavingsAtomic: futureSavings.toString(),
    resultingUtxoCount: candidates.length === 0 ? 0 : 1,
    excluded,
  };
}

function exactMultiplyRoundUp(a: string, b: string): string {
  const left = a.split('.');
  const right = b.split('.');
  const scale = (left[1]?.length ?? 0) + (right[1]?.length ?? 0);
  const product = BigInt(left.join('')) * BigInt(right.join(''));
  const unit = 10n ** BigInt(scale);
  const rounded = (product + unit - 1n) / unit;
  return rounded.toString();
}

function exactRatio(numerator: bigint, denominator: bigint): string {
  // Six fractional digits, truncated: a display ratio, never a float.
  const scale = 1_000_000n;
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const scaled = (n * scale) / d;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(6, '0').replace(/0+$/, '');
  const text = fraction.length === 0 ? `${whole}` : `${whole}.${fraction}`;
  return negative && scaled !== 0n ? `-${text}` : text;
}

function exactDivide(numerator: bigint, denominator: number): string {
  // Two fractional digits, truncated: the break-even rate is a display
  // estimate, and the assumptions are stated in the UI. 10^6 numerator
  // scale over a 10^4 denominator scale leaves the rate with two decimals.
  const scaled = (numerator * 1_000_000n) / BigInt(Math.round(denominator * 10_000));
  const whole = scaled / 100n;
  const fraction = (scaled % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return fraction.length === 0 ? `${whole}` : `${whole}.${fraction}`;
}
