import { describe, expect, it } from 'vitest';
import {
  atomicToDisplay,
  compareExact,
  displayToAtomic,
  formatExact,
  isPositiveExact,
  sumExact,
  truncateIdentifier,
} from './exact';

describe('exact presentation helpers', () => {
  it('shifts the decimal point with string arithmetic', () => {
    expect(atomicToDisplay('250000', 8)).toBe('0.0025');
    expect(atomicToDisplay('100000000', 8)).toBe('1');
    expect(atomicToDisplay('1500', 3)).toBe('1.5');
    expect(atomicToDisplay('-2500', 2)).toBe('-25');
    expect(atomicToDisplay(null, 8)).toBeNull();
    expect(atomicToDisplay('oops', 8)).toBeNull();
  });

  it('converts display back to atomic exactly', () => {
    expect(displayToAtomic('0.0025', 8)).toBe('250000');
    expect(displayToAtomic('1', 8)).toBe('100000000');
    expect(displayToAtomic('nope', 8)).toBeNull();
  });

  it('formats with grouping without ever building a float', () => {
    expect(formatExact('1234567.891', 'en')).toBe('1\u202f234\u202f567.891');
    expect(formatExact('-42', 'en')).toBe('-42');
    expect(formatExact('1000000', 'en', { maximumFractionDigits: 2 })).toBe('1\u202f000\u202f000');
    expect(formatExact('junk', 'en')).toBe('-');
  });

  it('compares exactly across scales', () => {
    expect(compareExact('0.1', '0.10')).toBe(0);
    expect(compareExact('2', '10')).toBe(-1);
    expect(compareExact('-1', '-2')).toBe(1);
  });

  it('sums exactly and refuses malformed members', () => {
    expect(sumExact(['0.1', '0.2', '1'])).toBe('1.3');
    expect(sumExact(['9007199254740993', '1'])).toBe('9007199254740994');
    expect(sumExact(['1', null])).toBeNull();
    expect(sumExact(['1', 'junk'])).toBeNull();
  });

  it('detects positive exact values', () => {
    expect(isPositiveExact('0.00000001')).toBe(true);
    expect(isPositiveExact('0')).toBe(false);
    expect(isPositiveExact('-1')).toBe(false);
    expect(isPositiveExact(null)).toBe(false);
  });

  it('truncates identifiers with both ends visible', () => {
    expect(truncateIdentifier('bc1qabcdefghijk1234567890', 8, 6)).toBe('bc1qabcd…567890');
    expect(truncateIdentifier('short')).toBe('short');
  });
});
