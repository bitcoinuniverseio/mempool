import { describe, expect, it } from 'vitest';

import { emptyBlockStats, intervalStats, isEmptyBlock, poolShares, type BlockSample } from './mining-analysis';

const TARGET = 60;

function sample(height: number, timeOffsetSeconds = 0, overrides: Partial<BlockSample> = {}): BlockSample {
  return {
    height: String(height),
    time: 1_700_000_000 + height * TARGET + timeOffsetSeconds,
    txCount: 1500,
    sizeBytes: 1_000_000,
    minerName: 'pool-a',
    ...overrides,
  };
}

describe('intervalStats', () => {
  it('measures the gaps between consecutive blocks', () => {
    const stats = intervalStats([sample(102), sample(101), sample(100)], TARGET);
    expect(stats.samples).toBe(2);
    expect(stats.meanSeconds).toBe(60);
    expect(stats.drift).toBe(0);
  });

  it('finds slow blocks against twice the target', () => {
    const stats = intervalStats([sample(101, 200), sample(100)], TARGET);
    expect(stats.slowBlocks).toEqual(['101']);
    expect(stats.slowestSeconds).toBe(260);
  });

  it('summarizes nothing when there is nothing to summarize', () => {
    const stats = intervalStats([], TARGET);
    expect(stats.samples).toBe(0);
    expect(stats.meanSeconds).toBeNull();
    expect(stats.drift).toBeNull();
  });
});

describe('emptyBlockStats', () => {
  it('counts subsidy-only blocks and states the share', () => {
    const blocks = [
      sample(100, 0, { txCount: 1 }),
      sample(101, 0, { txCount: 2000, minerName: 'pool-b' }),
      sample(102, 0, { txCount: 1 }),
      sample(103, 0),
    ];
    const stats = emptyBlockStats(blocks);
    expect(stats.samples).toBe(4);
    expect(stats.emptyCount).toBe(2);
    expect(stats.emptyShare).toBe(0.5);
    expect(stats.emptyHeights).toEqual(['100', '102']);
  });
  it('treats one transaction as empty and two as not', () => {
    expect(isEmptyBlock(1)).toBe(true);
    expect(isEmptyBlock(2)).toBe(false);
  });
});

describe('poolShares', () => {
  it('counts each pool and keeps the unknowns named rather than guessed', () => {
    const blocks = [
      sample(100, 0, { minerName: 'pool-a' }),
      sample(101, 0, { minerName: 'pool-a' }),
      sample(102, 0, { minerName: null }),
    ];
    const shares = poolShares(blocks);
    expect(shares[0]).toEqual({ name: 'pool-a', blocks: 2, share: 0.667 });
    expect(shares[1]).toEqual({ name: 'unknown', blocks: 1, share: 0.333 });
  });
});
