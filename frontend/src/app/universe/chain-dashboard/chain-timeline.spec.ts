import { readChainTimeline } from '@app/universe/chain-dashboard/chain-timeline';
import { readCandidateBuckets } from '@app/universe/multichain-explorer/candidate-buckets';
import { RecentBlocksView } from '@app/universe/universe.types';

const NOW = Date.parse('2026-08-30T12:00:00Z');

function recentBlocks(heights: number[]): RecentBlocksView {
  return {
    schemaVersion: 'universe-recent-blocks-v1',
    chain: 'dogecoin',
    network: 'mainnet',
    tip: {
      heightAtomic: String(Math.max(...heights)),
      blockHash: 'f'.repeat(64),
      observedAt: '2026-08-30T11:59:50Z',
    },
    blocks: heights
      .slice()
      .sort((a, b) => b - a)
      .map((height, index) => ({
        heightAtomic: String(height),
        hash: `${height}`.padStart(64, 'a'),
        time: new Date(NOW - (index + 1) * 60_000).toISOString(),
        txCountAtomic: '42',
        sizeBytesAtomic: index === 0 ? '20000' : '10000',
        feesAtomic: '488725270',
        subsidyAtomic: '1000000000000',
        rewardAtomic: '1000488725270',
        medianFeeRateDecimal: '2010471.204',
        difficultyDecimal: '13648321.5',
        intervalSecondsAtomic: '61',
        miner: { poolId: null, name: null, evidence: null },
      })),
    coverage: {
      fromHeightAtomic: String(Math.min(...heights)),
      toHeightAtomic: String(Math.max(...heights)),
      complete: true,
    },
    observedAt: '2026-08-30T12:00:00Z',
  };
}

const BUCKETS_PAYLOAD = {
  schemaVersion: 'universe-candidate-buckets-v1',
  chain: 'dogecoin',
  network: 'mainnet',
  snapshotId: 'dogecoin-mainnet-abc',
  sequenceAtomic: '7',
  observedAt: '2026-08-30T11:59:58Z',
  tip: {
    heightAtomic: '6353486',
    blockHash: 'f'.repeat(64),
    observedAt: '2026-08-30T11:59:50Z',
  },
  completeness: 'complete',
  semantics: 'ordered-by-fee-policy',
  feeModel: {
    kind: 'fee-per-kilobyte',
    unit: 'koinu/kB',
    minRelayFeeAtomicPerKb: '100000',
  },
  capacity: {
    maxBlockSizeBytesAtomic: '1000000',
    minerSoftCapBytesAtomic: null,
    targetBlockSecondsAtomic: '60',
  },
  buckets: [
    {
      indexAtomic: '0',
      txCountAtomic: '41',
      totalSizeBytesAtomic: '10835',
      totalFeesAtomic: '488725270',
      feeQuantilesDecimal: ['1', '2', '3', '4', '5', '6', '7', '8'],
      medianFeeDecimal: '4',
      fillDecimal: '0.01',
      overflow: false,
      unknownFeeCountAtomic: '0',
    },
    {
      indexAtomic: '1',
      txCountAtomic: '9',
      totalSizeBytesAtomic: '900',
      totalFeesAtomic: '100',
      feeQuantilesDecimal: ['1', '1', '1', '1', '1', '1', '1', '1'],
      medianFeeDecimal: '1',
      fillDecimal: '0.001',
      overflow: true,
      unknownFeeCountAtomic: '0',
    },
  ],
  disclosures: ['ordered-not-a-forecast'],
};

function bucketsReading(): ReturnType<typeof readCandidateBuckets> {
  return readCandidateBuckets(BUCKETS_PAYLOAD, 8, 'DOGE');
}

describe('Chain timeline reading', () => {
  it('derives future heights from the freshest tip, one slot per bucket', () => {
    const reading = readChainTimeline(
      recentBlocks([6353484, 6353485, 6353486]),
      bucketsReading(),
      BUCKETS_PAYLOAD,
      8,
      NOW
    );
    expect(reading).not.toBeNull();
    expect(reading!.future.length).toBe(2);
    expect(reading!.future[0].height?.exact).toBe('6353487');
    expect(reading!.future[1].height?.exact).toBe('6353488');
    expect(reading!.future[0].targetMinutes).toBe(1);
    expect(reading!.future[1].targetMinutes).toBe(2);
  });

  it('keeps exact heights on confirmed cubes, newest first', () => {
    const reading = readChainTimeline(
      recentBlocks([6353484, 6353485, 6353486]),
      null,
      null,
      8,
      NOW
    );
    expect(reading!.confirmed.map((cube) => cube.height.exact)).toEqual([
      '6353486',
      '6353485',
      '6353484',
    ]);
    expect(reading!.confirmed[0].age).toContain('min ago');
    expect(reading!.confirmed[0].totalFees?.exact).toBe('488725270');
  });

  it('uses the stored tip when the bucket snapshot is older', () => {
    const stale = JSON.parse(JSON.stringify(BUCKETS_PAYLOAD));
    stale.tip.heightAtomic = '6353400';
    const reading = readChainTimeline(
      recentBlocks([6353486]),
      bucketsReading(),
      stale,
      8,
      NOW
    );
    expect(reading!.future[0].height?.exact).toBe('6353487');
  });

  it('never duplicates a confirmed height on the future side', () => {
    const reading = readChainTimeline(
      recentBlocks([6353486]),
      bucketsReading(),
      BUCKETS_PAYLOAD,
      8,
      NOW
    );
    const confirmedHeights = reading!.confirmed.map((cube) => cube.height.exact);
    for (const slot of reading!.future) {
      expect(confirmedHeights).not.toContain(slot.height?.exact);
    }
  });

  it('states the randomized-selection disclosure for tier semantics', () => {
    const tiers = JSON.parse(JSON.stringify(BUCKETS_PAYLOAD));
    tiers.semantics = 'zip317-eligibility-tiers';
    const reading = readChainTimeline(
      null,
      bucketsReading(),
      tiers,
      8,
      NOW
    );
    expect(reading!.orderingDisclosure).toContain('randomized');
  });

  it('returns null when neither side has anything to draw', () => {
    expect(readChainTimeline(null, null, null, 8, NOW)).toBeNull();
  });
});
