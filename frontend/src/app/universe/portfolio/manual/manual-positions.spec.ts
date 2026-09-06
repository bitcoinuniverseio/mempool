import { describe, expect, it } from 'vitest';
import { manualPositionError, manualPositionValue, type ManualPositionDraft } from './manual-positions';

const draft: ManualPositionDraft = { name: 'My position', kind: 'asset', quantity: '9007199254740993.12345678', unitPrice: '0.00000003', quoteCurrency: 'USD', effectiveAt: '2026-09-06' };

describe('explicit manual position values', () => {
  it.each([
    ['9007199254740993.12345678', '0.00000003', '270215977.6422297937037034'],
    ['0.000000000000000001', '0.000000000000000001', '0.000000000000000000000000000000000001'],
    ['2.50', '4', '10'], ['000.50', '02.00', '1'], ['0', '9', '0'], ['3', '0', '0'],
    ['1', undefined, null], ['1e3', '1', null], ['1', '-1', null],
  ])('keeps %s times %s exact as %s', (quantity, unitPrice, expected) => {
    expect(manualPositionValue({ quantity, unitPrice })).toBe(expected);
  });

  it('allows explicit values without price and normalizes currency labels at the editor boundary', () => {
    expect(manualPositionError(draft)).toBeNull();
    expect(manualPositionError({ ...draft, unitPrice: '', quoteCurrency: '' })).toBeNull();
    expect(manualPositionError({ ...draft, quoteCurrency: ' usd ' })).toBeNull();
    expect(manualPositionError({ ...draft, effectiveAt: '2024-02-29', kind: 'liability' })).toBeNull();
  });

  it.each([
    { quantity: '-1' }, { quantity: '1e8' }, { quantity: 'Infinity' },
    { quantity: '1'.repeat(61) }, { quantity: '0.' + '1'.repeat(19) },
    { unitPrice: '-1' }, { unitPrice: 'NaN' }, { quoteCurrency: '' },
    { quoteCurrency: 'US,D' }, { name: ' ' }, { name: 'x'.repeat(121) },
    { effectiveAt: '2026-02-29' }, { effectiveAt: '2026-13-01' }, { effectiveAt: '06/09/2026' },
  ])('rejects malformed or ambiguous input %j', override => {
    expect(manualPositionError({ ...draft, ...override })).not.toBeNull();
  });
});
