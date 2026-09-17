jest.mock('../config', () => ({
  __esModule: true,
  default: { MEMPOOL: { BLOCK_WEIGHT_UNITS: 4_000_000 } },
}));
jest.mock('worker_threads', () => ({ parentPort: null }));

import { makeBlockTemplates } from '../api/tx-selection-worker';
import { CompactThreadTransaction } from '../mempool.interfaces';

const MAX_BLOCK_SIGOPS = 80_000;

function transaction(uid: number, overrides: Partial<CompactThreadTransaction> = {}): CompactThreadTransaction {
  return {
    uid,
    fee: 200_000,
    weight: 100_000,
    feePerVsize: 8,
    effectiveFeePerVsize: 8,
    sigops: 16_000,
    inputs: [],
    ...overrides,
  };
}

function sigopsOf(block: number[], mempool: Map<number, CompactThreadTransaction>): number {
  return block.reduce((sum, uid) => sum + (mempool.get(uid)?.sigops ?? 0), 0);
}

describe('JavaScript block template sigop accounting', () => {
  it('keeps every bounded projected block within 80000 sigops for independent transactions', () => {
    const mempool = new Map<number, CompactThreadTransaction>();
    for (let uid = 1; uid <= 6; uid++) {
      mempool.set(uid, transaction(uid));
    }
    const { blocks } = makeBlockTemplates(mempool);
    // Six transactions of 16000 sigops each total 96000, which is more than one
    // block allows and far below the weight limit, so a second block is needed.
    expect(blocks.length).toBe(2);
    expect(blocks[0].length).toBe(5);
    expect(blocks[1]).toEqual([6]);
    for (const block of blocks.slice(0, 7)) {
      expect(sigopsOf(block, mempool)).toBeLessThanOrEqual(MAX_BLOCK_SIGOPS);
    }
    expect(blocks.flat().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('counts a parent once when it is placed as part of a child package', () => {
    const mempool = new Map<number, CompactThreadTransaction>();
    // Parent 1 (low fee) is pulled in by child 2 (high fee); their package
    // costs 32000 sigops. Three more independent 16000-sigop transactions
    // bring the total to exactly the limit, so all fit into one block only if
    // the parent is not counted twice.
    mempool.set(1, transaction(1, { fee: 1_000, feePerVsize: 0.04, effectiveFeePerVsize: 0.04 }));
    mempool.set(2, transaction(2, { fee: 400_000, feePerVsize: 16, effectiveFeePerVsize: 16, inputs: [1] }));
    mempool.set(3, transaction(3));
    mempool.set(4, transaction(4));
    mempool.set(5, transaction(5));
    const { blocks } = makeBlockTemplates(mempool);
    expect(blocks.length).toBe(1);
    expect(sigopsOf(blocks[0], mempool)).toBe(MAX_BLOCK_SIGOPS);
    expect(blocks[0].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('resets the sigop budget for each new bounded block', () => {
    const mempool = new Map<number, CompactThreadTransaction>();
    for (let uid = 1; uid <= 15; uid++) {
      mempool.set(uid, transaction(uid));
    }
    const { blocks } = makeBlockTemplates(mempool);
    expect(blocks.map((block) => block.length)).toEqual([5, 5, 5]);
    for (const block of blocks) {
      expect(sigopsOf(block, mempool)).toBeLessThanOrEqual(MAX_BLOCK_SIGOPS);
    }
  });
});
