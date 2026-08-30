/**
 * Candidate buckets, read for the cube row.
 *
 * The overlay groups each chain's pending set under that chain's own fee
 * rules and says exactly what the grouping means: an ordering under the
 * relay policy for Dogecoin, eligibility tiers under ZIP-317 for Zcash.
 * This reading turns that payload into cubes without ever strengthening
 * the claim: no ETA is derived from a target cadence, no ordering is
 * implied for tiers, and a disclosure id this build has no copy for is
 * still shown, as its id, rather than dropped.
 *
 * Colors are relative: a bucket's gradient maps its own fee quantiles onto
 * the theme ramp by position, because absolute thresholds in koinu/kB or
 * zatoshi-per-action would be numbers this explorer invented. The exact
 * figures are beside every cube.
 */

import {
  ExactNumber,
  formatAtomicAmount,
  formatExactInteger,
} from './multichain-view';

export interface CandidateCubeReading {
  readonly index: string;
  readonly overflow: boolean;
  /** The tier's short label, or null for an ordered bucket. */
  readonly tierLabel: string | null;
  readonly tierTone: 'proven' | 'partial' | 'neutral' | 'unavailable' | null;
  readonly txCount: ExactNumber | null;
  readonly totalSize: ExactNumber | null;
  /** Total fees shifted to the chain's ticker unit. Null when unknown. */
  readonly totalFees: ExactNumber | null;
  readonly medianFee: string | null;
  /** Lowest and highest known quantile, for the "a to b" span line. */
  readonly feeSpan: { readonly low: string; readonly high: string } | null;
  /** Fill against capacity, clamped to 0..100 for the gradient. */
  readonly fillPercent: number;
  /** Known fee quantiles, lowest first, for the relative gradient. */
  readonly quantiles: readonly string[];
  readonly unknownFeeCount: ExactNumber | null;
}

export interface CandidateBucketsReading {
  /** What the buckets are, in one honest sentence. */
  readonly semanticsNotice: string;
  /** The fee unit, exactly as the model names it. */
  readonly unit: string;
  /** The target cadence line. A target, never an ETA. */
  readonly cadenceNotice: string;
  readonly facts: readonly { label: string; value: string }[];
  readonly disclosures: readonly string[];
  readonly cubes: readonly CandidateCubeReading[];
  readonly completeness: string;
  readonly partial: boolean;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

function decimal(value: unknown): string | null {
  return typeof value === 'string' && DECIMAL.test(value) ? value : null;
}

const TIER_LABELS: Record<string, string> = {
  paid: $localize`:@@universe.buckets.tier-paid:Pays its conventional fee`,
  unpaid: $localize`:@@universe.buckets.tier-unpaid:Pays less than convention`,
  'fee-unknown': $localize`:@@universe.buckets.tier-fee-unknown:Fee not readable`,
  expiring: $localize`:@@universe.buckets.tier-expiring:Expiring`,
};

const TIER_TONES: Record<string, CandidateCubeReading['tierTone']> = {
  paid: 'proven',
  unpaid: 'partial',
  'fee-unknown': 'neutral',
  expiring: 'unavailable',
};

/**
 * The honest copy per disclosure id. An id this build has no words for is
 * shown as itself: an unreadable sentence beats a silently dropped claim.
 */
const DISCLOSURE_COPY: Record<string, string> = {
  'ordered-not-a-forecast': $localize`:@@universe.buckets.d-ordered:Ordered by the fee policy nodes relay by. This is not a forecast of the next mined block.`,
  'packs-consensus-limit': $localize`:@@universe.buckets.d-consensus:Buckets pack against the consensus block size limit. Miners commonly build against a smaller soft cap this explorer does not claim to know.`,
  'unknown-fees-not-placed': $localize`:@@universe.buckets.d-unknown-fees:Transactions whose fee could not be read are placed in no bucket. Not knowing a fee must neither promote nor demote a transaction.`,
  'zip317-random-selection': $localize`:@@universe.buckets.d-zip317:Zcash block producers select transactions by weighted random sampling under ZIP-317. These are eligibility tiers, not a queue, and no order is implied.`,
  'shielded-fee-unknown': $localize`:@@universe.buckets.d-shielded:A shielded transaction's fee cannot be read from its transparent side. Those transactions are in the fee-not-readable tier, never assumed paid or unpaid.`,
  'expiry-drops-candidates': $localize`:@@universe.buckets.d-expiry:An expiring transaction may never confirm at all. Zcash transactions carry an expiry height; past it they leave the pending set without a block.`,
  'unpaid-admission-not-modeled': $localize`:@@universe.buckets.d-unpaid:Whether an underpaying transaction is admitted depends on each block producer's unpaid budget, which this explorer does not model. The tier states eligibility only.`,
};

function readCube(entry: unknown): CandidateCubeReading | null {
  if (!isRecord(entry)) {
    return null;
  }
  const quantiles = Array.isArray(entry.feeQuantilesDecimal)
    ? entry.feeQuantilesDecimal
        .map((value) => decimal(value))
        .filter((value): value is string => value !== null)
    : [];
  const fill = Number(decimal(entry.fillDecimal) ?? '0');
  const tier = text(entry.tier);
  const unknownRaw = text(entry.unknownFeeCountAtomic);
  return {
    index: text(entry.indexAtomic) ?? '',
    overflow: entry.overflow === true,
    tierLabel: tier ? TIER_LABELS[tier] ?? tier : null,
    tierTone: tier ? TIER_TONES[tier] ?? 'neutral' : null,
    txCount: formatExactInteger(text(entry.txCountAtomic)),
    totalSize: formatExactInteger(text(entry.totalSizeBytesAtomic)),
    totalFees: null,
    medianFee: decimal(entry.medianFeeDecimal),
    feeSpan:
      quantiles.length >= 2
        ? { low: quantiles[0], high: quantiles[quantiles.length - 1] }
        : null,
    fillPercent: Math.max(0, Math.min(100, Math.round(fill * 100))),
    quantiles,
    unknownFeeCount:
      unknownRaw && unknownRaw !== '0' ? formatExactInteger(unknownRaw) : null,
  };
}

/**
 * The bucket view, read for the page. Returns null for anything that is not
 * a candidate-buckets payload, so everything else keeps its reading.
 */
export function readCandidateBuckets(
  payload: unknown,
  precision: number,
  ticker: string
): CandidateBucketsReading | null {
  if (
    !isRecord(payload) ||
    payload.schemaVersion !== 'universe-candidate-buckets-v1' ||
    !isRecord(payload.feeModel) ||
    !Array.isArray(payload.buckets)
  ) {
    return null;
  }
  const model = payload.feeModel;
  const unit = text(model.unit) ?? '';
  const semantics = text(payload.semantics);
  const capacity = isRecord(payload.capacity) ? payload.capacity : {};
  const targetSeconds = text(capacity.targetBlockSecondsAtomic);

  const cubes: CandidateCubeReading[] = [];
  for (const entry of payload.buckets) {
    const cube = readCube(entry);
    if (!cube) {
      continue;
    }
    const totalFees = formatAtomicAmount(
      isRecord(entry) ? text(entry.totalFeesAtomic) : null,
      precision
    );
    cubes.push(totalFees ? { ...cube, totalFees } : cube);
  }

  const facts: { label: string; value: string }[] = [];
  const maxSize = text(capacity.maxBlockSizeBytesAtomic);
  if (maxSize) {
    const size = formatExactInteger(maxSize);
    if (size) {
      facts.push({
        label: $localize`:@@universe.buckets.fact-capacity:Block size limit`,
        value: $localize`:@@universe.buckets.fact-capacity-bytes:${size.display}:SIZE: bytes`,
      });
    }
  }
  if (model.kind === 'fee-per-kilobyte') {
    const floor = formatAtomicAmount(text(model.minRelayFeeAtomicPerKb), precision);
    if (floor) {
      facts.push({
        label: $localize`:@@universe.buckets.fact-relay-floor:Relay floor`,
        value: `${floor.display} ${ticker}/kB`,
      });
    }
  }
  if (model.kind === 'zip-317') {
    const marginal = text(model.marginalFeeAtomic);
    if (marginal) {
      facts.push({
        label: $localize`:@@universe.buckets.fact-marginal:ZIP-317 marginal fee`,
        value: $localize`:@@universe.buckets.fact-marginal-value:${marginal}:FEE: zatoshis per logical action`,
      });
    }
  }

  const completeness = text(payload.completeness) ?? 'unavailable';
  return {
    semanticsNotice:
      semantics === 'zip317-eligibility-tiers'
        ? $localize`:@@universe.buckets.semantics-tiers:What is waiting, in the tiers ZIP-317 defines. No order is implied between or within them.`
        : $localize`:@@universe.buckets.semantics-ordered:What is waiting, ordered as the fee policy prices it. Not a forecast of the next mined block.`,
    unit,
    cadenceNotice: targetSeconds
      ? $localize`:@@universe.buckets.cadence:This chain targets a block every ${targetSeconds}:SECONDS: seconds. A target is not an arrival time, so no countdown is shown.`
      : '',
    facts,
    disclosures: Array.isArray(payload.disclosures)
      ? payload.disclosures
          .map((id) => (typeof id === 'string' ? DISCLOSURE_COPY[id] ?? id : ''))
          .filter((line) => line.length > 0)
      : [],
    cubes,
    completeness,
    partial: completeness !== 'complete',
  };
}

/**
 * The cube's background: the empty share on the left, then the known fee
 * quantiles as bands across the filled share, colored by their position on
 * the theme ramp. Pure, so it can be tested without a browser: the colors
 * arrive as an argument and the return value is a CSS background.
 */
export function cubeGradient(
  cube: CandidateCubeReading,
  colors: readonly string[]
): string {
  const empty = 100 - cube.fillPercent;
  if (!cube.quantiles.length || !colors.length || cube.fillPercent === 0) {
    return 'var(--u-block-projected-empty)';
  }
  const stops = [
    `var(--u-block-projected-empty), var(--u-block-projected-empty) ${empty}%`,
  ];
  const bands = cube.quantiles.length;
  for (let index = 0; index < bands; index += 1) {
    const color =
      colors[Math.round((index / Math.max(1, bands - 1)) * (colors.length - 1))];
    const from = empty + (index / bands) * cube.fillPercent;
    const to = empty + ((index + 1) / bands) * cube.fillPercent;
    stops.push(`#${color} ${from}%, #${color} ${to}%`);
  }
  return `repeating-linear-gradient(to right, ${stops.join(', ')})`;
}
