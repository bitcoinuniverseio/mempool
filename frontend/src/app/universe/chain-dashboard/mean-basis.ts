/**
 * What the mining means were actually taken over.
 *
 * The Mining page said "Means are measured over the last 960 collected
 * blocks" beside a mean reward that was not measured over 960 blocks. A Zcash
 * miner may pay its own share to a shielded address, and then neither the
 * reward nor the fees can be derived from public data; the backend leaves
 * those blocks out of the mean rather than counting them as zero, which is
 * right, and about three percent of every Zcash window is such a block.
 *
 * The overlay now publishes the two denominators. This turns them into the
 * sentence under the figures, and says nothing extra when there is nothing
 * extra to say: an overlay released before those fields existed sends
 * neither, and then the page states the window and stops, exactly as before.
 */

const COUNT = /^(0|[1-9][0-9]*)$/;

export interface MeanBasisReading {
  /** Blocks in the window. Always present when there is a window at all. */
  readonly windowBlocks: string;
  /** Blocks that stated a reward, when the overlay says. */
  readonly rewardBlocks: string | null;
  /** Blocks that stated fees, when the overlay says. */
  readonly feeBlocks: string | null;
  /**
   * True when at least one mean was taken over fewer blocks than the window,
   * which is when the difference is worth a sentence.
   */
  readonly narrower: boolean;
}

function count(value: string | null | undefined): string | null {
  return typeof value === 'string' && COUNT.test(value) ? value : null;
}

export function readMeanBasis(summary: {
  windowBlocksAtomic: string | null;
  rewardBlocksAtomic?: string | null;
  feeBlocksAtomic?: string | null;
} | null): MeanBasisReading | null {
  const windowBlocks = count(summary?.windowBlocksAtomic);
  if (windowBlocks === null) {
    return null;
  }
  const rewardBlocks = count(summary?.rewardBlocksAtomic);
  const feeBlocks = count(summary?.feeBlocksAtomic);
  const narrower =
    (rewardBlocks !== null && rewardBlocks !== windowBlocks) ||
    (feeBlocks !== null && feeBlocks !== windowBlocks);
  return { windowBlocks, rewardBlocks, feeBlocks, narrower };
}
