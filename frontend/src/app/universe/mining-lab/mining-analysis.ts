/**
 * What a run of recent blocks says about the mining behind it.
 *
 * Intervals, emptiness, and who is finding blocks are all visible in block
 * summaries; this module turns them into stated statistics with their
 * denominators. Every number here knows how many blocks it saw, and the
 * module refuses to summarize a window it cannot see.
 */

export interface BlockSample {
  readonly height: string;
  /** Unix seconds. */
  readonly time: number;
  readonly txCount: number;
  readonly sizeBytes: number | null;
  readonly minerName: string | null;
}

export interface IntervalStats {
  readonly samples: number;
  readonly meanSeconds: number | null;
  readonly medianSeconds: number | null;
  readonly slowestSeconds: number | null;
  readonly fastestSeconds: number | null;
  /** Blocks slower than twice the target. Named with their heights. */
  readonly slowBlocks: readonly string[];
  /** Target interval in seconds, from the caller who knows the chain. */
  readonly targetSeconds: number;
  /** How far the mean sits from the target, as a ratio, or null. */
  readonly drift: number | null;
}

/** Interval statistics over consecutive blocks, newest first in, oldest first out. */
export function intervalStats(blocks: readonly BlockSample[], targetSeconds: number): IntervalStats {
  const ordered = [...blocks].reverse();
  const intervals: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const gap = ordered[i].time - ordered[i - 1].time;
    if (Number.isFinite(gap) && gap >= 0) {
      intervals.push(gap);
    }
  }
  if (!intervals.length) {
    return {
      samples: 0, meanSeconds: null, medianSeconds: null, slowestSeconds: null,
      fastestSeconds: null, slowBlocks: [], targetSeconds, drift: null,
    };
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const slowBlocks = ordered
    .map((block, index) => ({ block, interval: intervals[index - 1] ?? null }))
    .filter(({ interval }) => interval !== null && interval > targetSeconds * 2)
    .map(({ block }) => block.height);

  return {
    samples: intervals.length,
    meanSeconds: Math.round(mean),
    medianSeconds: Math.round(median),
    slowestSeconds: sorted[sorted.length - 1],
    fastestSeconds: sorted[0],
    slowBlocks,
    targetSeconds,
    drift: targetSeconds > 0 ? Math.round(((mean - targetSeconds) / targetSeconds) * 100) / 100 : null,
  };
}

/** A block that found only its subsidy is an empty block, by any name. */
export function isEmptyBlock(txCount: number): boolean {
  return txCount <= 1;
}

export interface EmptyBlockStats {
  readonly samples: number;
  readonly emptyCount: number;
  readonly emptyShare: number | null;
  readonly emptyHeights: readonly string[];
}

export function emptyBlockStats(blocks: readonly BlockSample[]): EmptyBlockStats {
  const samples = blocks.length;
  const empty = blocks.filter((block) => isEmptyBlock(block.txCount));
  return {
    samples,
    emptyCount: empty.length,
    emptyShare: samples ? Math.round((empty.length / samples) * 1000) / 1000 : null,
    emptyHeights: empty.map((block) => block.height),
  };
}

export interface PoolShare {
  readonly name: string;
  readonly blocks: number;
  readonly share: number | null;
}

/** Pool shares over the window. Unknown miners are shown as unknown, never guessed. */
export function poolShares(blocks: readonly BlockSample[]): readonly PoolShare[] {
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const block of blocks) {
    if (block.minerName) {
      counts.set(block.minerName, (counts.get(block.minerName) ?? 0) + 1);
    } else {
      unknown += 1;
    }
  }
  const total = blocks.length;
  const shares: PoolShare[] = [...counts.entries()]
    .map(([name, blocksFound]) => ({
      name,
      blocks: blocksFound,
      share: total ? Math.round((blocksFound / total) * 1000) / 1000 : null,
    }))
    .sort((a, b) => b.blocks - a.blocks);
  if (unknown) {
    shares.push({ name: 'unknown', blocks: unknown, share: total ? Math.round((unknown / total) * 1000) / 1000 : null });
  }
  return shares;
}
