import { describe, expect, it } from 'vitest';
import {
  blocksAhead,
  formatOptionalFeerate,
  headlineFor,
  MAX_PACKAGE_SIZE,
  splitRawTransactions,
} from './package-input';
import { PackageSimulation, PackageTxView, ReplacementView } from './mempool-intelligence.types';

/** Long enough to pass the length floor, and obviously not a real transaction. */
const RAW_A = 'ab'.repeat(60);
const RAW_B = 'cd'.repeat(60);

describe('splitRawTransactions', () => {
  it('reads one transaction', () => {
    expect(splitRawTransactions(RAW_A)).toEqual({ rawTxs: [RAW_A], error: null });
  });

  it('reads transactions separated by newlines', () => {
    expect(splitRawTransactions(`${RAW_A}\n${RAW_B}`).rawTxs).toEqual([RAW_A, RAW_B]);
  });

  it('reads a JSON array pasted whole', () => {
    const pasted = `["${RAW_A}", "${RAW_B}"]`;
    expect(splitRawTransactions(pasted).rawTxs).toEqual([RAW_A, RAW_B]);
  });

  it('lowercases, so the same transaction in two cases is one transaction', () => {
    const result = splitRawTransactions(`${RAW_A.toUpperCase()}\n${RAW_A}`);
    expect(result.error).toContain('twice');
  });

  it('refuses an empty box rather than asking the node about nothing', () => {
    expect(splitRawTransactions('   ').error).toContain('at least one');
    expect(splitRawTransactions('').error).toContain('at least one');
  });

  it('refuses more than a node will relay as one package', () => {
    const many = Array.from({ length: MAX_PACKAGE_SIZE + 1 }, (_, i) =>
      'ab'.repeat(59) + i.toString(16).padStart(2, '0')).join('\n');
    const result = splitRawTransactions(many);
    expect(result.error).toContain(String(MAX_PACKAGE_SIZE));
    expect(result.rawTxs).toEqual([]);
  });

  it('refuses anything that is not hexadecimal', () => {
    expect(splitRawTransactions('0x' + RAW_A).error).toContain('hexadecimal');
    expect(splitRawTransactions('zz'.repeat(60)).error).toContain('hexadecimal');
  });

  it('refuses an odd number of characters, which is half a byte short', () => {
    expect(splitRawTransactions(RAW_A + 'a').error).toContain('odd');
  });

  it('names a transaction id pasted where a raw transaction was meant', () => {
    const txid = 'a'.repeat(64);
    // A txid is hexadecimal and even, so only the length distinguishes it,
    // and it is the mistake people actually make.
    expect(splitRawTransactions(txid).error).toContain('not a raw transaction');
  });

  it('rejects the whole paste rather than the bad part of it', () => {
    // Half a package is not a package, and simulating the half that parsed
    // would answer a question nobody asked.
    expect(splitRawTransactions(`${RAW_A}\nnothex`).rawTxs).toEqual([]);
  });
});

function tx(options: Partial<PackageTxView> = {}): PackageTxView {
  return {
    txid: 'a'.repeat(64),
    vsize: 100,
    weight: 400,
    feeSats: 1000,
    feeUnknownReason: null,
    individualFeerate: 10,
    effectiveFeerate: 10,
    chunkIndex: 0,
    parents: [],
    children: [],
    externalInputs: 1,
    mempoolInputs: 0,
    allowed: true,
    rejectReason: null,
    effectiveIncludes: [],
    ...options,
  };
}

function simulation(options: Partial<PackageSimulation> = {}): PackageSimulation {
  return {
    transactions: [tx()],
    topologicalOrder: ['a'.repeat(64)],
    chunks: [],
    accepted: true,
    conflicts: [],
    replacement: null,
    queuePosition: null,
    packageFeeSats: 1000,
    packageVsize: 100,
    packageWeight: 400,
    connected: true,
    cyclic: false,
    ...options,
  };
}

function replacement(options: Partial<ReplacementView> = {}): ReplacementView {
  return {
    conflictCount: 1,
    evictedTxids: ['b'.repeat(64)],
    evictedFeeSats: 1000,
    evictedVsize: 150,
    packageFeeSats: 5000,
    packageVsize: 200,
    requiredFeeSats: 1200,
    shortfallSats: 0,
    satisfiesFeeRules: true,
    incompleteReason: null,
    ...options,
  };
}

describe('headlineFor', () => {
  it('says a package would be accepted', () => {
    const headline = headlineFor(simulation());
    expect(headline.kind).toBe('accepted');
    expect(headline.positive).toBe(true);
  });

  it('says what a replacement would evict when it would be accepted', () => {
    const headline = headlineFor(simulation({ replacement: replacement() }));
    expect(headline.kind).toBe('accepted');
    expect(headline.text).toContain('replacing 1 transaction');
  });

  it('states the shortfall and the total, not merely that it is short', () => {
    const headline = headlineFor(simulation({
      accepted: false,
      replacement: replacement({ shortfallSats: 400, requiredFeeSats: 1400, satisfiesFeeRules: false }),
    }));
    expect(headline.kind).toBe('replacement-short');
    expect(headline.text).toContain('400 satoshis less');
    expect(headline.text).toContain('1400');
  });

  it('prefers the shortfall over the general rejection', () => {
    // The shortfall is the only part of the answer anyone can act on.
    const headline = headlineFor(simulation({
      accepted: false,
      transactions: [tx({ allowed: false, rejectReason: 'insufficient fee' })],
      replacement: replacement({ shortfallSats: 250, satisfiesFeeRules: false }),
    }));
    expect(headline.kind).toBe('replacement-short');
  });

  it('passes on the node own words for a single rejection', () => {
    const headline = headlineFor(simulation({
      accepted: false,
      transactions: [tx({ allowed: false, rejectReason: 'min relay fee not met' })],
    }));
    expect(headline.text).toContain('min relay fee not met');
  });

  it('counts the rejections when there are several', () => {
    const headline = headlineFor(simulation({
      accepted: false,
      transactions: [
        tx({ txid: 'a'.repeat(64), allowed: false, rejectReason: 'one' }),
        tx({ txid: 'b'.repeat(64), allowed: false, rejectReason: 'two' }),
        tx({ txid: 'c'.repeat(64) }),
      ],
    }));
    expect(headline.text).toContain('2 of these 3');
  });

  it('reports a loop before anything else, since nothing else applies to one', () => {
    const headline = headlineFor(simulation({ cyclic: true, accepted: false }));
    expect(headline.kind).toBe('unreadable');
    expect(headline.text).toContain('loop');
  });

  it('reports an incomplete fee rather than implying the rules were met', () => {
    const headline = headlineFor(simulation({
      accepted: true,
      replacement: replacement({
        satisfiesFeeRules: false,
        incompleteReason: 'At least one fee in this package is not known.',
      }),
    }));
    expect(headline.positive).toBe(false);
    expect(headline.text).toContain('not known');
  });

  it('pluralizes the eviction count', () => {
    const headline = headlineFor(simulation({
      replacement: replacement({ evictedTxids: ['b'.repeat(64), 'c'.repeat(64)] }),
    }));
    expect(headline.text).toContain('2 transactions');
  });
});

describe('blocksAhead', () => {
  it('rounds down, because a partial block ahead is not a block ahead', () => {
    expect(blocksAhead(0)).toBe(0);
    expect(blocksAhead(999_999)).toBe(0);
    expect(blocksAhead(1_000_000)).toBe(1);
    expect(blocksAhead(2_500_000)).toBe(2);
  });
});

describe('formatOptionalFeerate', () => {
  it('formats a rate the same way every cluster page does', () => {
    expect(formatOptionalFeerate(12.345)).toBe('12.35');
    expect(formatOptionalFeerate(10)).toBe('10.00');
  });

  it('says unknown rather than showing a number for one', () => {
    expect(formatOptionalFeerate(null)).toBe('unknown');
    expect(formatOptionalFeerate(Number.NaN)).toBe('unknown');
  });
});
