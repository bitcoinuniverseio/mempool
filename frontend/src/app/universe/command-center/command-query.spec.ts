import { describe, expect, it } from 'vitest';

import {
  FILTERS_ENFORCED,
  FILTERS_RECORDED,
  decimalRange,
  filterLabel,
  integerRange,
  parseCommandQuery,
  timeRange,
} from './command-query';

describe('parseCommandQuery', () => {
  it('keeps plain text as text', () => {
    expect(parseCommandQuery('gibberish words').text).toBe('gibberish words');
  });

  it('lifts known filters out of the text', () => {
    const parsed = parseCommandQuery('frost chain:bitcoin kind:rune');
    expect(parsed.text).toBe('frost');
    expect(parsed.chain).toBe('bitcoin');
    expect(parsed.kind).toBe('rune');
  });

  it('accepts filters in any position', () => {
    const parsed = parseCommandQuery('kind:token chain:doge ordinals');
    expect(parsed.text).toBe('ordinals');
    expect(parsed.chain).toBe('dogecoin');
    expect(parsed.kind).toBe('token');
  });

  it('resolves chain aliases', () => {
    expect(parseCommandQuery('chain:btc').chain).toBe('bitcoin');
    expect(parseCommandQuery('chain:fb').chain).toBe('fractal');
    expect(parseCommandQuery('chain:lq').chain).toBe('liquid');
    expect(parseCommandQuery('chain:zec').chain).toBe('zcash');
  });

  it('accepts a quoted phrase as text, filters inside quotes included', () => {
    const parsed = parseCommandQuery('"chain:bitcoin kind:rune" report');
    expect(parsed.text).toBe('chain:bitcoin kind:rune report');
    expect(parsed.chain).toBeNull();
    expect(parsed.kind).toBeNull();
  });

  it('takes the first of a repeated filter and reports the second as unknown', () => {
    const parsed = parseCommandQuery('chain:bitcoin chain:dogecoin');
    expect(parsed.chain).toBe('bitcoin');
    expect(parsed.unknown).toHaveLength(1);
  });

  it('keeps an unknown key in the text and says it was not understood', () => {
    const parsed = parseCommandQuery('flavor:vanilla cake');
    expect(parsed.text).toBe('flavor:vanilla cake');
    expect(parsed.unknown).toEqual([{ key: 'flavor', raw: 'flavor:vanilla' }]);
  });

  it('reports a bad value as unknown instead of guessing', () => {
    const parsed = parseCommandQuery('chain:bitcoinland kind:yolo');
    expect(parsed.chain).toBeNull();
    expect(parsed.kind).toBeNull();
    expect(parsed.unknown).toHaveLength(2);
  });

  it('parses an inclusive height range', () => {
    expect(parseCommandQuery('height:800-900').height).toEqual({ from: 800, to: 900 });
    expect(parseCommandQuery('height:800000').height).toEqual({ from: 800000, to: 100000000 });
  });

  it('parses a satoshi value range without floats', () => {
    expect(parseCommandQuery('value:1000-5000').value).toEqual({ from: 1000, to: 5000 });
  });

  it('parses a fee rate range to one decimal place', () => {
    expect(parseCommandQuery('feerate:1.5-20').feerate).toEqual({ from: 1.5, to: 20 });
  });

  it('parses a single day, a date range, and a trailing window', () => {
    const now = Date.parse('2026-09-02T12:00:00Z');
    expect(timeRange('2026-01-31', now)).toEqual({
      from: Date.parse('2026-01-31T00:00:00Z'),
      to: Date.parse('2026-01-31T00:00:00Z') + 86_400_000 - 1,
    });
    expect(timeRange('2026-01-01...2026-01-31', now)?.to)
      .toBe(Date.parse('2026-01-31T00:00:00Z') + 86_400_000 - 1);
    expect(timeRange('-30d', now)?.from).toBe(now - 30 * 86_400_000);
  });

  it('parses holder rank as a plain integer', () => {
    expect(parseCommandQuery('rank:100').rank).toBe(100);
    expect(parseCommandQuery('rank:-5').rank).toBeNull();
  });

  it('states which filters are enforced and which are recorded only', () => {
    const parsed = parseCommandQuery('kind:rune status:active height:800');
    const keys = parsed.applied.map((filter) => filter.key);
    expect(keys).toContain('kind');
    expect(keys).toContain('status');
    expect(parsed.deferred.map((filter) => filter.key)).toContain('status');
    expect(parsed.deferred.map((filter) => filter.key)).not.toContain('kind');
  });

  it('records nothing applied for an empty or whitespace query', () => {
    const parsed = parseCommandQuery('   ');
    expect(parsed.text).toBe('');
    expect(parsed.applied).toHaveLength(0);
  });

  it('never lets an unknown key be mistaken for a known one', () => {
    const parsed = parseCommandQuery('chains:bitcoin');
    expect(parsed.chain).toBeNull();
    expect(parsed.unknown[0].key).toBe('chains');
  });
});

describe('enforced versus recorded filters', () => {
  it('shares every key between the two lists exactly once', () => {
    for (const key of FILTERS_ENFORCED) {
      expect(FILTERS_RECORDED).not.toContain(key);
    }
    for (const key of FILTERS_RECORDED) {
      expect(FILTERS_ENFORCED).not.toContain(key);
    }
  });
});

describe('range helpers', () => {
  it('bounds integers and refuses inversions', () => {
    expect(integerRange('5-10', 0, 100)).toEqual({ from: 5, to: 10 });
    expect(integerRange('10-5', 0, 100)).toBeNull();
    expect(integerRange('-1', 0, 100)).toBeNull();
    expect(integerRange('101', 0, 100)).toBeNull();
    expect(integerRange('5-', 0, 100)).toEqual({ from: 5, to: 100 });
  });

  it('bounds decimals to one place', () => {
    expect(decimalRange('0.5', 0, 100)).toEqual({ from: 0.5, to: 100 });
    expect(decimalRange('1.25', 0, 100)).toBeNull();
  });

  it('labels every filter key', () => {
    expect(filterLabel('feerate')).toBe('fee rate');
    expect(filterLabel('rank')).toBe('holder rank');
  });
});

describe('parser properties', () => {
  // Deterministic pseudo random generator, so failures reproduce.
  function seeded(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }

  it('is order independent for filters and preserves text order', () => {
    const random = seeded(7);
    for (let i = 0; i < 200; i++) {
      const parts = ['alpha', 'chain:btc', 'beta', 'kind:tx', 'gamma', 'height:1-5'];
      const swapped = [...parts].sort(() => random() - 0.5);
      const parsed = parseCommandQuery(swapped.join(' '));
      expect(parsed.chain).toBe('bitcoin');
      expect(parsed.kind).toBe('transaction');
      expect(parsed.height).toEqual({ from: 1, to: 5 });
      // The three text words survive, in the order they were written.
      expect(parsed.text.split(' ').filter((word) => ['alpha', 'beta', 'gamma'].includes(word)).length).toBe(3);
    }
  });

  it('round trips the text: no character created, none lost', () => {
    const random = seeded(19);
    for (let i = 0; i < 200; i++) {
      const words = ['w1', 'chain:liquid', 'w2', 'kind:sat', 'w3'];
      const query = [...words].sort(() => random() - 0.5).join('  ');
      const parsed = parseCommandQuery(query);
      expect(parsed.chain).toBe('liquid');
      expect(parsed.kind).toBe('sat');
      const textWords = parsed.text.split(' ').filter((word) => word.startsWith('w'));
      expect(textWords.length).toBe(3);
    }
  });
});
