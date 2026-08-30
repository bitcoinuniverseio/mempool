/**
 * The chain timeline, read for the block strip.
 *
 * One reader builds both sides of the horizontal timeline: recent confirmed
 * blocks on one side, upcoming target slots on the other. Every cube carries
 * the height it stands for. Confirmed heights are exact; future heights are
 * derived from the freshest tip this page holds and labeled as expectations.
 *
 * The future side never strengthens a claim the chain cannot back. Dogecoin
 * buckets are an ordering under the relay policy, so bucket k maps to slot
 * k. Zcash block producers select randomly under ZIP-317, so its slots are
 * capacity arithmetic over the whole pending set: slot one summarizes what
 * is eligible, later slots say only how much pending size lies beyond one
 * more block of capacity. Size is tier-neutral, so that arithmetic implies
 * no order.
 */

import {
  ExactNumber,
  formatAtomicAmount,
  formatExactInteger,
} from '@app/universe/multichain-explorer/multichain-view';
import {
  CandidateBucketsReading,
  CandidateCubeReading,
} from '@app/universe/multichain-explorer/candidate-buckets';
import {
  ChainBlockSummary,
  ChainExplorerPayload,
  RecentBlocksView,
} from '@app/universe/universe.types';

export interface TimelineFutureSlot {
  /** "6,353,487", derived from the freshest tip. Null without a tip. */
  readonly height: ExactNumber | null;
  /** Minutes until this slot's target, from the chain's target spacing. */
  readonly targetMinutes: number | null;
  readonly cube: CandidateCubeReading;
  /** True for a light slot that states capacity overflow only. */
  readonly overflowOnly: boolean;
}

export interface TimelineConfirmedCube {
  readonly height: ExactNumber;
  readonly hash: string;
  /** Median fee rate in the chain's fee unit, or null when unknown. */
  readonly medianFeeRate: string | null;
  /** Total fees in the ticker unit. Null when the collector could not prove it. */
  readonly totalFees: ExactNumber | null;
  readonly txCount: ExactNumber | null;
  readonly sizeBytes: ExactNumber | null;
  /** "3 minutes ago", from the block header time. */
  readonly age: string;
  readonly timeExact: string;
  /** The proven pool name, or null. The template renders Unknown itself. */
  readonly minerName: string | null;
  /** Fill against the largest recent block, 8..100, for the gradient depth. */
  readonly fillPercent: number;
}

export interface ChainTimelineReading {
  /** Nearest slot first. */
  readonly future: readonly TimelineFutureSlot[];
  /** Newest block first. */
  readonly confirmed: readonly TimelineConfirmedCube[];
  readonly unit: string;
  readonly cadenceNotice: string;
  /** Set for chains whose producers do not honor an ordering. */
  readonly orderingDisclosure: string | null;
  readonly partial: boolean;
}

function tipHeight(value: unknown): bigint | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const height = (value as { heightAtomic?: unknown }).heightAtomic;
  return typeof height === 'string' && /^(0|[1-9][0-9]*)$/.test(height)
    ? BigInt(height)
    : null;
}

function ageLabel(timeIso: string, nowMs: number): string {
  const thenMs = Date.parse(timeIso);
  if (!Number.isFinite(thenMs)) {
    return '';
  }
  const seconds = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (seconds < 60) {
    return $localize`:@@universe.timeline.age-now:Just now`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return $localize`:@@universe.timeline.age-minutes:${minutes}:MINUTES: min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return $localize`:@@universe.timeline.age-hours:${hours}:HOURS: h ago`;
  }
  const days = Math.floor(hours / 24);
  return $localize`:@@universe.timeline.age-days:${days}:DAYS: d ago`;
}

function confirmedCube(
  block: ChainBlockSummary,
  precision: number,
  largestSizeBytes: bigint,
  nowMs: number
): TimelineConfirmedCube | null {
  if (
    !/^(0|[1-9][0-9]*)$/.test(block.heightAtomic) ||
    typeof block.hash !== 'string' ||
    !block.hash
  ) {
    return null;
  }
  const size =
    typeof block.sizeBytesAtomic === 'string' &&
    /^(0|[1-9][0-9]*)$/.test(block.sizeBytesAtomic)
      ? BigInt(block.sizeBytesAtomic)
      : null;
  const fill =
    size !== null && largestSizeBytes > 0n
      ? Number((size * 100n) / largestSizeBytes)
      : 0;
  return {
    height: formatExactInteger(block.heightAtomic) ?? {
      display: block.heightAtomic,
      exact: block.heightAtomic,
    },
    hash: block.hash,
    medianFeeRate: block.medianFeeRateDecimal,
    totalFees: formatAtomicAmount(block.feesAtomic, precision),
    txCount: formatExactInteger(block.txCountAtomic),
    sizeBytes: formatExactInteger(block.sizeBytesAtomic),
    age: ageLabel(block.time, nowMs),
    timeExact: block.time,
    minerName: block.miner?.name ?? null,
    fillPercent: Math.min(100, Math.max(8, fill)),
  };
}

/**
 * How many future slots the reading shows. Enough to say what is near,
 * few enough that the strip stays a timeline rather than a queue dump.
 */
const MAXIMUM_FUTURE_SLOTS = 6;

export function readChainTimeline(
  recentBlocks: RecentBlocksView | null,
  buckets: CandidateBucketsReading | null,
  bucketsPayload: ChainExplorerPayload | null,
  precision: number,
  nowMs: number
): ChainTimelineReading | null {
  const blocks = recentBlocks?.blocks ?? [];
  const cubes = buckets?.cubes ?? [];
  if (!blocks.length && !cubes.length) {
    return null;
  }

  const recentTip = tipHeight(recentBlocks?.tip);
  const bucketTip = tipHeight(
    bucketsPayload && typeof bucketsPayload === 'object'
      ? (bucketsPayload as { tip?: unknown }).tip
      : null
  );
  const newestStored = blocks.length ? BigInt(blocks[0].heightAtomic) : null;
  const candidates = [recentTip, bucketTip, newestStored].filter(
    (value): value is bigint => value !== null
  );
  const tip = candidates.length
    ? candidates.reduce((a, b) => (a > b ? a : b))
    : null;

  const targetSeconds = readTargetSeconds(bucketsPayload);

  const future: TimelineFutureSlot[] = cubes
    .slice(0, MAXIMUM_FUTURE_SLOTS)
    .map((cube, index) => ({
      height:
        tip !== null
          ? formatExactInteger(String(tip + BigInt(index + 1)))
          : null,
      targetMinutes:
        targetSeconds !== null
          ? Math.max(1, Math.round(((index + 1) * targetSeconds) / 60))
          : null,
      cube,
      overflowOnly: cube.overflow,
    }));

  const largest = blocks.reduce((best, block) => {
    const size =
      typeof block.sizeBytesAtomic === 'string' &&
      /^(0|[1-9][0-9]*)$/.test(block.sizeBytesAtomic)
        ? BigInt(block.sizeBytesAtomic)
        : 0n;
    return size > best ? size : best;
  }, 0n);

  const confirmed = blocks
    .map((block) => confirmedCube(block, precision, largest, nowMs))
    .filter((cube): cube is TimelineConfirmedCube => cube !== null);

  return {
    future,
    confirmed,
    unit: buckets?.unit ?? '',
    cadenceNotice: buckets?.cadenceNotice ?? '',
    orderingDisclosure:
      buckets && bucketSemantics(bucketsPayload) === 'zip317-eligibility-tiers'
        ? $localize`:@@universe.timeline.zcash-ordering:Zcash block producers select transactions with randomized weighting under ZIP-317. Slots show capacity and eligibility, never a promised order.`
        : null,
    partial: buckets?.partial ?? false,
  };
}

function bucketSemantics(payload: ChainExplorerPayload | null): string | null {
  const semantics =
    payload && typeof payload === 'object'
      ? (payload as { semantics?: unknown }).semantics
      : null;
  return typeof semantics === 'string' ? semantics : null;
}

function readTargetSeconds(payload: ChainExplorerPayload | null): number | null {
  const capacity =
    payload && typeof payload === 'object'
      ? (payload as { capacity?: unknown }).capacity
      : null;
  if (typeof capacity !== 'object' || capacity === null) {
    return null;
  }
  const target = (capacity as { targetBlockSecondsAtomic?: unknown })
    .targetBlockSecondsAtomic;
  return typeof target === 'string' && /^[1-9][0-9]*$/.test(target)
    ? Number(target)
    : null;
}
