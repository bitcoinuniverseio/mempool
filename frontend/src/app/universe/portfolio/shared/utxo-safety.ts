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

/** Conservative single-key input estimates (vB), not measured signed transaction sizes.
 * P2WPKH: 41 base bytes + 109 witness bytes / 4, rounded up.
 * Nested P2WPKH adds 23 base bytes. Taproot assumes key path, no annex,
 * and a 65-byte signature; script-path spending is not estimated.
 * Serialization/weight: https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki
 */
export const INPUT_VBYTES: Readonly<Record<string, number>> = {
  p2wpkh: 69,
  'p2sh-p2wpkh': 92,
  p2pkh: 149,
  p2tr: 58,
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
  if (!/^\d{1,16}$/.test(valueAtomic) || !/^\d{1,7}(\.\d{1,3})?$/.test(feeRateSatPerVb)) {
    return null;
  }
  const vbytes = INPUT_VBYTES[scriptType];
  if (vbytes === undefined) return null;
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
  if (!/^\d{1,16}$/.test(utxo.valueAtomic)) classes.add('unknown-asset-state');
  if (utxo.pending) classes.add('pending');
  if (utxo.spent) classes.add('spent');
  // For Bitcoin, confirmations at the observed tip determine eligibility for
  // the next block: Core COINBASE_MATURITY is 100. A future maturity height
  // alone does not mean an already mature output is still immature.
  if (utxo.coinbase) {
    if (utxo.chain !== 'bitcoin' || !/^\d{1,16}$/.test(utxo.confirmationsAtomic)) classes.add('unknown-asset-state');
    else if (BigInt(utxo.confirmationsAtomic) < 100n || utxo.pending) classes.add('immature-coinbase');
  }
  if (utxo.assets.length > 0) {
    classes.add('asset-bearing');
  }
  if (utxo.assetState !== 'proven') {
    classes.add('unknown-asset-state');
  }
  for (const warning of utxo.warnings) {
    for (const { hint, warnClass } of WARNING_CLASS_HINTS) {
      if (warning.includes(hint)) classes.add(warnClass);
    }
  }
  const dust = options.dustThresholdAtomic;
  if (dust !== undefined && /^\d{1,16}$/.test(dust) && /^\d{1,16}$/.test(utxo.valueAtomic) && BigInt(utxo.valueAtomic) <= BigInt(dust)) {
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
  readonly estimateOnly: true;
  readonly assumptions: readonly string[];
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
  const validRate = (rate: string) => /^\d{1,7}(\.\d{1,3})?$/.test(rate);
  if (utxos.length > 10000 || alternativeRatesSatVb.length > 20 || !validRate(currentRateSatVb) || !alternativeRatesSatVb.every(validRate)) {
    throw new Error('Invalid or oversized consolidation estimate input');
  }
  const candidates: PortfolioUtxo[] = [];
  const excluded: { outpoint: string; reason: string }[] = [];
  const seen = new Set<string>();
  let network: string | undefined;
  for (const utxo of utxos) {
    const outpoint = `${utxo.chain}:${utxo.network}:${utxo.txid}:${utxo.vout}`;
    let reason = '';
    if (seen.has(outpoint)) reason = 'Duplicate outpoint is not counted twice.';
    else if (utxo.chain !== 'bitcoin' || (network !== undefined && network !== utxo.network)) reason = 'A consolidation estimate requires one Bitcoin network.';
    else if (!/^\d{1,16}$/.test(utxo.valueAtomic) || INPUT_VBYTES[utxo.scriptType] === undefined) reason = 'Value or script input size cannot be estimated.';
    else if (classifyUtxo(utxo).primary !== 'plain-proven') reason = 'Asset coverage, maturity or lifecycle does not support a plain-output estimate.';
    seen.add(outpoint);
    if (reason) excluded.push({ outpoint, reason });
    else { network = utxo.network; candidates.push(utxo); }
  }
  const total = candidates.reduce((sum, utxo) => sum + BigInt(utxo.valueAtomic), 0n);
  const inputVbytes = candidates.reduce((sum, utxo) => sum + INPUT_VBYTES[utxo.scriptType], 0);
  // One P2WPKH output (31 bytes), version/locktime, CompactSize counts,
  // and conservative rounded marker/flag overhead for witness transactions.
  const countBytes = candidates.length < 253 ? 1 : 3;
  const hasWitness = candidates.some(utxo => utxo.scriptType !== 'p2pkh');
  const overhead = 8 + countBytes + 1 + (hasWitness ? 1 + Math.ceil(candidates.filter(utxo => utxo.scriptType === 'p2pkh').length / 4) : 0);
  const txVbytes = inputVbytes + overhead + 31;
  const feeAt = (rate: string) => candidates.length ? exactMultiplyRoundUp(String(txVbytes), rate) : '0';
  const currentFee = feeAt(currentRateSatVb);
  // Savings is the difference between future spending of all original
  // inputs and spending the one new P2WPKH input, at the supplied rate.
  const futureSavings = candidates.length ? exactMultiplyRoundUp(String(Math.max(0, inputVbytes - INPUT_VBYTES.p2wpkh)), currentRateSatVb) : '0';
  return {
    estimateOnly: true,
    assumptions: ['Single P2WPKH resulting output; conservative single-key input sizes.', 'Taproot key-path only, no annex; no script-path estimate.', 'No native transaction acceptance, dust or spend authorization is established.'],
    candidateCount: candidates.length,
    totalValueAtomic: total.toString(),
    currentFeeAtomic: currentFee,
    alternativeFees: alternativeRatesSatVb.map(rate => ({ rateSatVb: rate, feeAtomic: feeAt(rate) })),
    futureInputSavingsAtomic: futureSavings,
    resultingUtxoCount: candidates.length === 0 || total <= BigInt(currentFee) ? 0 : 1,
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
