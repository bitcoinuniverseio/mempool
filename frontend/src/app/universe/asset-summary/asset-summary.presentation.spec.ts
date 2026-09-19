import { describe, expect, it } from 'vitest';
import {
  COMPACT_THRESHOLD,
  compactDecimal,
  exactDecimal,
  groupIntegerDigits,
  initialsFor,
  presentQuantity,
  shortenAssetId,
} from './asset-summary.presentation';

describe('exact decimal scaling', () => {
  it('scales by string surgery, never by arithmetic', () => {
    expect(exactDecimal('1234', 2)).toBe('12.34');
    expect(exactDecimal('1', 8)).toBe('0.00000001');
    expect(exactDecimal('100000000', 8)).toBe('1');
  });

  it('keeps a quantity larger than a safe integer exact', () => {
    const huge = '123456789012345678901234567890';
    expect(exactDecimal(huge, 0)).toBe(huge);
    expect(exactDecimal(huge, 10)).toBe('12345678901234567890.123456789');
  });

  it('treats zero divisibility as a whole count, not as unknown', () => {
    expect(exactDecimal('5', 0)).toBe('5');
  });

  it('refuses to scale when divisibility is unknown or out of range', () => {
    expect(exactDecimal('1234', null)).toBeNull();
    expect(exactDecimal('1234', 39)).toBeNull();
    expect(exactDecimal('1234', -1)).toBeNull();
    expect(exactDecimal('1234', 1.5)).toBeNull();
  });

  it('refuses a quantity that is not an unsigned integer string', () => {
    expect(exactDecimal('-1', 0)).toBeNull();
    expect(exactDecimal('1.5', 0)).toBeNull();
    expect(exactDecimal('01', 0)).toBeNull();
    expect(exactDecimal('1e3', 0)).toBeNull();
  });

  it('accepts the contract boundary of thirty eight places', () => {
    expect(exactDecimal('1', 38)).toBe('0.' + '0'.repeat(37) + '1');
  });
});

describe('digit grouping', () => {
  it('groups the integer part and leaves the fraction alone', () => {
    expect(groupIntegerDigits('1234567')).toBe('1,234,567');
    expect(groupIntegerDigits('1234567.891011')).toBe('1,234,567.891011');
    expect(groupIntegerDigits('0.000001')).toBe('0.000001');
  });
});

describe('explicit approximation', () => {
  it('leaves a short value alone so nothing implies rounding', () => {
    expect(compactDecimal('12.34')).toBeNull();
    expect(compactDecimal('1,234,567')).toBeNull();
  });

  it('shortens a long integer with a magnitude suffix', () => {
    expect(compactDecimal(groupIntegerDigits('1234567890'))).toBe('1.23B');
    expect(compactDecimal(groupIntegerDigits('21000000000000'))).toBe('21T');
  });

  it('never rounds a small nonzero value to zero', () => {
    const tiny = exactDecimal('1', 38);
    expect(tiny).not.toBeNull();
    const short = compactDecimal(tiny as string);
    // The smallest representable amount at the contract's divisibility limit.
    // Zero would be a false statement about a balance somebody holds.
    expect(short).not.toBe('0');
    expect(short).toBe('1e-38');
  });

  it('keeps a small fraction positional while that fits', () => {
    const value = exactDecimal('123', 10);
    expect(value).toBe('0.0000000123');
    // Twelve characters exactly: it fits, so it is not shortened at all.
    expect(compactDecimal(value as string)).toBeNull();
  });

  it('falls back to an exponent rather than to zero or to a weak bound', () => {
    const value = exactDecimal('123', 20);
    expect(compactDecimal(value as string)).toBe('1.23e-18');
  });

  it('shortens a value beyond the largest magnitude suffix', () => {
    const value = '1' + '0'.repeat(39);
    expect(compactDecimal(groupIntegerDigits(value))).toBe('1e39');
  });

  it('never produces a headline longer than the column allows', () => {
    const values = [
      '1234567890123456789012345678901234567890',
      '0.' + '0'.repeat(20) + '123',
      '999999999999999.999999',
      '1000.' + '1'.repeat(30),
    ];
    for (const value of values) {
      const grouped = groupIntegerDigits(value);
      const short = compactDecimal(grouped) ?? grouped;
      expect(short.length).toBeLessThanOrEqual(COMPACT_THRESHOLD + 4);
    }
  });
});

describe('presented quantity', () => {
  it('states an exact value when divisibility is known', () => {
    const presented = presentQuantity('1234', 2);
    expect(presented.kind).toBe('exact');
    expect(presented.headline).toBe('12.34');
    expect(presented.exact).toBe('12.34');
    expect(presented.approximate).toBe(false);
  });

  it('shows true digits labelled raw when divisibility is unknown', () => {
    const presented = presentQuantity('1234', null);
    expect(presented.kind).toBe('raw');
    // The digits are exactly what the authority said; only the scale is unknown.
    expect(presented.exact).toBe('1234');
    expect(presented.headline).toBe('1,234');
  });

  it('keeps zero as zero and unknown as unknown', () => {
    const zero = presentQuantity('0', 8);
    expect(zero.kind).toBe('exact');
    expect(zero.headline).toBe('0');

    const unknown = presentQuantity(null, 8);
    expect(unknown.kind).toBe('unknown');
    expect(unknown.headline).toBe('');
    expect(unknown.exact).toBe('');
  });

  it('marks a long value approximate and keeps the exact string for copying', () => {
    const presented = presentQuantity('123456789012345678', 0);
    expect(presented.approximate).toBe(true);
    expect(presented.exact).toBe('123456789012345678');
    expect(presented.headline).not.toBe(presented.exact);
    expect(presented.headline.length).toBeLessThan(presented.exact.length);
  });

  it('carries the partial flag without changing the value', () => {
    const presented = presentQuantity('100', 0, false);
    expect(presented.partial).toBe(true);
    expect(presented.exact).toBe('100');
  });

  it('reports a malformed quantity as unknown rather than as zero', () => {
    expect(presentQuantity('not-a-number', 0).kind).toBe('unknown');
    expect(presentQuantity('-5', 0).kind).toBe('unknown');
  });
});

describe('identity presentation', () => {
  it('builds initials from the first useful candidate', () => {
    expect(initialsFor('', 'Uncommon Goods')).toBe('UG');
    expect(initialsFor('runes')).toBe('RU');
    expect(initialsFor('', '', '')).toBe('?');
  });

  it('keeps both ends of an identifier it shortens', () => {
    const id = 'a'.repeat(6) + 'b'.repeat(20) + 'c'.repeat(6);
    const short = shortenAssetId(id, 6);
    expect(short.startsWith('aaaaaa')).toBe(true);
    expect(short.endsWith('cccccc')).toBe(true);
    expect(short.length).toBeLessThan(id.length);
  });

  it('leaves a short identifier untouched', () => {
    expect(shortenAssetId('SHORT', 6)).toBe('SHORT');
  });
});
