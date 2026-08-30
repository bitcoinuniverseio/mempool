import { describe, expect, it } from 'vitest';
import {
  ChartValueContext,
  formatAxisValue,
  formatPointDisplay,
  plotValue,
} from '@app/universe/chain-graphs/chain-chart-format';

const doge: ChartValueContext = {
  precision: 8,
  ticker: 'DOGE',
  rateUnit: 'hashes-per-second',
};

const zec: ChartValueContext = {
  precision: 8,
  ticker: 'ZEC',
  rateUnit: 'solutions-per-second',
};

describe('plotValue', () => {
  it('shifts atomic amounts to the ticker unit', () => {
    expect(plotValue('100000000', 'atomic-amount', 8)).toBe(1);
    expect(plotValue('2500000000', 'atomic-amount', 8)).toBe(25);
  });

  it('shifts shares to percent so a stacked chart tops out at 100', () => {
    expect(plotValue('0.5', 'share', 8)).toBe(50);
  });

  it('keeps everything else as sent', () => {
    expect(plotValue('61.4', 'seconds', 8)).toBe(61.4);
    expect(plotValue('1234', 'count', 8)).toBe(1234);
  });

  it('plots a missing or malformed value as a gap, never as zero', () => {
    expect(plotValue(null, 'count', 8)).toBeNull();
    expect(plotValue('not-a-number', 'count', 8)).toBeNull();
  });
});

describe('formatAxisValue', () => {
  it('humanizes bytes', () => {
    expect(formatAxisValue(1_500_000, 'bytes', doge)).toBe('1.5 MB');
    expect(formatAxisValue(512, 'bytes', doge)).toBe('512 B');
  });

  it('writes amounts with the ticker', () => {
    expect(formatAxisValue(12_500, 'atomic-amount', doge)).toBe('12.5k DOGE');
  });

  it('writes rates in the unit the hashrate line stated', () => {
    expect(formatAxisValue(2_000_000_000_000, 'rate', doge)).toBe('2TH/s');
    expect(formatAxisValue(5_000, 'rate', zec)).toBe('5kSol/s');
  });

  it('writes seconds as seconds and longer spans as minutes', () => {
    expect(formatAxisValue(61, 'seconds', doge)).toBe('61 s');
    expect(formatAxisValue(150, 'seconds', doge)).toBe('3 min');
  });

  it('writes shares as percent', () => {
    expect(formatAxisValue(42.4, 'share', doge)).toBe('42%');
  });

  it('shrinks large counts and difficulties with SI suffixes', () => {
    expect(formatAxisValue(21_000_000, 'difficulty', doge)).toBe('21M');
    expect(formatAxisValue(1_500, 'count', doge)).toBe('1.5k');
  });
});

describe('formatPointDisplay', () => {
  it('shifts an atomic amount exactly, by string arithmetic', () => {
    expect(formatPointDisplay('100000000', 'atomic-amount', doge, null)).toBe('1 DOGE');
  });

  it('groups an integer count', () => {
    expect(formatPointDisplay('123456', 'count', doge, null)).toBe('123,456');
  });

  it('writes a share to two decimals of percent', () => {
    expect(formatPointDisplay('0.1234', 'share', doge, null)).toBe('12.34%');
  });

  it('writes a rate in the unit the line stated', () => {
    expect(formatPointDisplay('5000', 'rate', zec, 'solutions-per-second')).toBe('5.00 kSol/s');
  });

  it('keeps a fee rate with the unit the backend stated', () => {
    expect(formatPointDisplay('12.5', 'fee-rate', doge, 'koinu/kB')).toBe('12.5 koinu/kB');
  });

  it('renders an absent value as absent, not as zero', () => {
    expect(formatPointDisplay(null, 'count', doge, null)).toBe('');
  });

  it('humanizes bytes', () => {
    expect(formatPointDisplay('2500000', 'bytes', doge, null)).toBe('2.5 MB');
  });

  it('writes seconds through the shared seconds formatter', () => {
    expect(formatPointDisplay('61.4', 'seconds', doge, null)).toBe('61 s');
  });
});
