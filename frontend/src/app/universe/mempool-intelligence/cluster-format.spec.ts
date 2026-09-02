import {
  describeChunk,
  describeFreshness,
  formatFeerate,
  formatSats,
  shorten,
} from './cluster-format';

describe('describeFreshness', () => {
  it('says nothing at all when there is no snapshot', () => {
    expect(describeFreshness(null)).toBeNull();
  });

  it('calls a snapshot inside its budget current', () => {
    const view = describeFreshness({
      builtAt: '2026-09-01T00:00:00.000Z',
      ageMs: 1200,
      budgetMs: 5000,
      withinBudget: true,
      mempoolSize: 10,
    });
    expect(view.tone).toBe('proven');
    expect(view.ageSeconds).toBe(1);
  });

  it('separates a snapshot that has merely aged from one that is out of date', () => {
    // The middle state matters. An answer that aged past its budget is still
    // a real answer, and collapsing it into "out of date" would understate it
    // just as calling it current would overstate it.
    const aged = describeFreshness({
      builtAt: '2026-09-01T00:00:00.000Z',
      ageMs: 20_000,
      budgetMs: 5000,
      withinBudget: false,
      mempoolSize: 10,
    });
    const stale = describeFreshness({
      builtAt: '2026-09-01T00:00:00.000Z',
      ageMs: 120_000,
      budgetMs: 5000,
      withinBudget: false,
      mempoolSize: 10,
    });
    expect(aged.tone).toBe('partial');
    expect(stale.tone).toBe('unavailable');
    expect(aged.label).not.toBe(stale.label);
  });

  it('never reports a negative age', () => {
    const view = describeFreshness({
      builtAt: '2026-09-01T00:00:00.000Z',
      ageMs: -50,
      budgetMs: 5000,
      withinBudget: true,
      mempoolSize: 0,
    });
    expect(view.ageSeconds).toBe(0);
  });
});

describe('formatSats', () => {
  it('groups thousands', () => {
    expect(formatSats(1234567)).toBe('1,234,567');
  });

  it('keeps a small number unchanged', () => {
    expect(formatSats(5)).toBe('5');
  });

  it('handles a negative value', () => {
    expect(formatSats(-1234)).toBe('-1,234');
  });

  it('answers an empty string rather than NaN', () => {
    // A cell reading "NaN" is worse than a blank one, because it looks like a
    // value that was computed.
    expect(formatSats(Number.NaN)).toBe('');
    expect(formatSats(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('formatFeerate', () => {
  it('shows two decimals', () => {
    expect(formatFeerate(5.5)).toBe('5.50');
    expect(formatFeerate(1)).toBe('1.00');
  });

  it('answers an empty string for a value that is not a number', () => {
    expect(formatFeerate(Number.NaN)).toBe('');
  });
});

describe('shorten', () => {
  it('shortens a long identifier from both ends', () => {
    const long = 'a'.repeat(64);
    expect(shorten(long)).toBe('aaaaaaaa…aaaaaaaa');
  });

  it('leaves a short value alone', () => {
    expect(shorten('abc')).toBe('abc');
  });
});

describe('describeChunk', () => {
  it('describes a single chunk cluster as one group', () => {
    expect(describeChunk(0, 1)).toContain('one group');
  });

  it('distinguishes the first group from a later one', () => {
    expect(describeChunk(0, 3)).not.toBe(describeChunk(1, 3));
  });
});
