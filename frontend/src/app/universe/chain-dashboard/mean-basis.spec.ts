import { describe, expect, it } from 'vitest';

import { readMeanBasis } from './mean-basis';

describe('what the mining means were taken over', () => {
  it('says nothing extra when every block in the window stated both', () => {
    const basis = readMeanBasis({
      windowBlocksAtomic: '960',
      rewardBlocksAtomic: '960',
      feeBlocksAtomic: '960',
    });
    expect(basis).toEqual({
      windowBlocks: '960',
      rewardBlocks: '960',
      feeBlocks: '960',
      narrower: false,
    });
  });

  // The production reading: about three percent of every Zcash window is a
  // block whose coinbase pays a shielded address, so neither figure can be
  // derived from it and the mean is over the rest.
  it('marks the difference when a mean was taken over fewer blocks', () => {
    const basis = readMeanBasis({
      windowBlocksAtomic: '960',
      rewardBlocksAtomic: '931',
      feeBlocksAtomic: '931',
    });
    expect(basis?.narrower).toBe(true);
    expect(basis?.rewardBlocks).toBe('931');
  });

  it('marks the difference when only one of the two is narrower', () => {
    expect(
      readMeanBasis({
        windowBlocksAtomic: '3',
        rewardBlocksAtomic: '1',
        feeBlocksAtomic: '3',
      })?.narrower,
    ).toBe(true);
  });

  // An overlay released before the fields existed sends neither, and the page
  // has to stay correct against it rather than inventing a denominator.
  it('states the window alone when the overlay does not publish denominators', () => {
    const basis = readMeanBasis({ windowBlocksAtomic: '960' });
    expect(basis).toEqual({
      windowBlocks: '960',
      rewardBlocks: null,
      feeBlocks: null,
      narrower: false,
    });
  });

  it('treats a window where nothing could be read as narrower, not as absent', () => {
    const basis = readMeanBasis({
      windowBlocksAtomic: '3',
      rewardBlocksAtomic: '0',
      feeBlocksAtomic: '0',
    });
    expect(basis?.narrower).toBe(true);
    expect(basis?.rewardBlocks).toBe('0');
  });

  it('has nothing to say without a window', () => {
    expect(readMeanBasis({ windowBlocksAtomic: null })).toBeNull();
    expect(readMeanBasis(null)).toBeNull();
  });

  it('refuses a count that is not a whole number', () => {
    const basis = readMeanBasis({
      windowBlocksAtomic: '960',
      rewardBlocksAtomic: '93.5',
      feeBlocksAtomic: '-4',
    });
    expect(basis?.rewardBlocks).toBeNull();
    expect(basis?.feeBlocks).toBeNull();
    expect(basis?.narrower).toBe(false);
  });
});
