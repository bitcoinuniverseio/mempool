import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatAtomicAmount,
  formatBtcAmountAsSats,
} from '@app/universe/universe-evidence';

const amountTemplates = [
  './ark/ark-dashboard.component.html',
  './l2-observatory/l2-observatory.component.html',
  './liquid-observatory/liquid-observatory.component.html',
  './payment-studio/payment-studio.component.html',
  './utxo-set/utxo-set.component.html',
  './zcash-privacy/zcash-privacy.component.html',
] as const;

describe('exact product amount display', () => {
  it('keeps every atomic digit above the safe integer limit', () => {
    expect(formatAtomicAmount('9007199254740993', 8)).toBe(
      '90,071,992.54740993'
    );
    expect(formatAtomicAmount('9007199254740993', 9)).toBe(
      '9,007,199.254740993'
    );
  });

  it('converts BIP21 BTC decimals to satoshis as strings', () => {
    expect(formatBtcAmountAsSats('90071992.54740993')).toBe(
      '9,007,199,254,740,993'
    );
    expect(formatBtcAmountAsSats('0.00000001')).toBe('1');
    expect(formatBtcAmountAsSats('1')).toBe('100,000,000');
  });

  it('refuses malformed atomic and BTC values', () => {
    expect(formatAtomicAmount('1e8', 8)).toBe('');
    expect(formatAtomicAmount('9007199254740993.1', 8)).toBe('');
    expect(formatBtcAmountAsSats('1e8')).toBe('');
    expect(formatBtcAmountAsSats('01')).toBe('');
    expect(formatBtcAmountAsSats('1.000000001')).toBe('');
    expect(formatBtcAmountAsSats(undefined as never)).toBe('');
  });

  it('keeps product amount templates free of numeric coercion', () => {
    for (const relativePath of amountTemplates) {
      const template = readFileSync(
        new URL(relativePath, import.meta.url),
        'utf8'
      );
      expect(template, relativePath).not.toMatch(/\bNumber\s*\(/);
      expect(template, relativePath).not.toMatch(/\bparse(?:Float|Int)\s*\(/);
    }
  });
});
