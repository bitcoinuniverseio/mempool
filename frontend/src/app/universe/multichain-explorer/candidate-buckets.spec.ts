import { describe, expect, it } from 'vitest';
import {
  cubeGradient,
  readCandidateBuckets,
} from '@app/universe/multichain-explorer/candidate-buckets';

/** A Dogecoin view, in the exact overlay contract shape. */
const DOGE_VIEW = {
  schemaVersion: 'universe-candidate-buckets-v1',
  chain: 'dogecoin',
  network: 'mainnet',
  snapshotId: 'snap-1',
  sequenceAtomic: '7',
  observedAt: '2026-08-30T07:00:00.000Z',
  tip: { heightAtomic: '5900001', blockHash: 'd'.repeat(64), observedAt: '2026-08-30T07:00:00.000Z' },
  completeness: 'complete',
  semantics: 'ordered-by-fee-policy',
  feeModel: { kind: 'fee-per-kilobyte', unit: 'koinu/kB', minRelayFeeAtomicPerKb: '100000' },
  capacity: {
    maxBlockSizeBytesAtomic: '1000000',
    minerSoftCapBytesAtomic: null,
    targetBlockSecondsAtomic: '60',
  },
  buckets: [
    {
      indexAtomic: '0',
      txCountAtomic: '2',
      totalSizeBytesAtomic: '1200',
      totalFeesAtomic: '6600000',
      feeQuantilesDecimal: ['1000000', null, null, null, null, null, null, '10000000'],
      medianFeeDecimal: '1000000',
      fillDecimal: '0.001',
      overflow: false,
      unknownFeeCountAtomic: '0',
    },
    {
      indexAtomic: '1',
      txCountAtomic: '3',
      totalSizeBytesAtomic: '1800',
      totalFeesAtomic: null,
      feeQuantilesDecimal: [null, null, null, null, null, null, null, null],
      medianFeeDecimal: null,
      fillDecimal: '0.001',
      overflow: true,
      unknownFeeCountAtomic: '2',
    },
  ],
  disclosures: ['ordered-not-a-forecast', 'unknown-fees-not-placed', 'some-future-id'],
};

describe('readCandidateBuckets', () => {
  it('reads the view without strengthening any claim', () => {
    const reading = readCandidateBuckets(DOGE_VIEW, 8, 'DOGE');
    expect(reading).not.toBeNull();
    expect(reading!.unit).toBe('koinu/kB');
    // The cadence line names a target, never an arrival time.
    expect(reading!.cadenceNotice).toContain('60');
    expect(reading!.cadenceNotice).not.toMatch(/in ~|minutes away/i);
    expect(reading!.semanticsNotice).toContain('Not a forecast');
    expect(reading!.cubes).toHaveLength(2);
    const first = reading!.cubes[0];
    expect(first.txCount?.display).toBe('2');
    // Total fees shift by the chain precision: 6600000 koinu is 0.066 DOGE.
    expect(first.totalFees?.display).toBe('0.066');
    expect(first.feeSpan).toEqual({ low: '1000000', high: '10000000' });
  });

  it('keeps the overflow bucket honest about what it holds', () => {
    const reading = readCandidateBuckets(DOGE_VIEW, 8, 'DOGE');
    const overflow = reading!.cubes[1];
    expect(overflow.overflow).toBe(true);
    expect(overflow.totalFees).toBeNull();
    expect(overflow.unknownFeeCount?.display).toBe('2');
    expect(overflow.medianFee).toBeNull();
  });

  it('shows a disclosure id it has no copy for rather than dropping it', () => {
    const reading = readCandidateBuckets(DOGE_VIEW, 8, 'DOGE');
    expect(reading!.disclosures).toHaveLength(3);
    expect(reading!.disclosures[2]).toBe('some-future-id');
  });

  it('labels ZIP-317 tiers and never implies an order', () => {
    const reading = readCandidateBuckets(
      {
        ...DOGE_VIEW,
        semantics: 'zip317-eligibility-tiers',
        feeModel: {
          kind: 'zip-317',
          unit: 'zatoshi/logical-action',
          revisionAtomic: '1',
          marginalFeeAtomic: '5000',
          graceActionsAtomic: '2',
          unpaidActionLimitAtomic: null,
        },
        buckets: [
          { ...DOGE_VIEW.buckets[0], tier: 'fee-unknown' },
        ],
        disclosures: ['zip317-random-selection'],
      },
      8,
      'ZEC'
    );
    expect(reading!.semanticsNotice).toContain('No order is implied');
    expect(reading!.cubes[0].tierLabel).toBe('Fee not readable');
    expect(reading!.cubes[0].tierTone).toBe('neutral');
  });

  it('is not this reading at all for other payloads', () => {
    expect(readCandidateBuckets({ transactions: [] }, 8, 'DOGE')).toBeNull();
    expect(readCandidateBuckets(null, 8, 'DOGE')).toBeNull();
  });
});

describe('cubeGradient', () => {
  const cube = {
    index: '0',
    overflow: false,
    tierLabel: null,
    tierTone: null,
    txCount: null,
    totalSize: null,
    totalFees: null,
    medianFee: null,
    feeSpan: null,
    fillPercent: 50,
    quantiles: ['1', '2', '3', '4'],
    unknownFeeCount: null,
  };

  it('leaves the empty share empty and bands the filled share', () => {
    const gradient = cubeGradient(cube, ['aaaaaa', 'bbbbbb', 'cccccc']);
    expect(gradient).toContain('var(--u-block-projected-empty) 50%');
    expect(gradient).toContain('#aaaaaa');
    expect(gradient).toContain('#cccccc');
  });

  it('renders an empty cube with no bands at all', () => {
    expect(cubeGradient({ ...cube, fillPercent: 0 }, ['aaaaaa'])).toBe(
      'var(--u-block-projected-empty)'
    );
    expect(cubeGradient({ ...cube, quantiles: [] }, ['aaaaaa'])).toBe(
      'var(--u-block-projected-empty)'
    );
  });
});
