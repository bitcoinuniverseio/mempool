import type { LocalManualEntry } from '../stores/portfolio-model';

export interface ManualPositionDraft {
  name: string;
  kind: 'asset' | 'liability';
  quantity: string;
  unitPrice: string;
  quoteCurrency: string;
  effectiveAt: string;
}

const DECIMAL = /^\d{1,60}(?:\.\d{1,18})?$/;

export function manualPositionError(draft: ManualPositionDraft): string | null {
  if (!draft.name.trim() || draft.name.trim().length > 120) { return 'Enter a position name of up to 120 characters.'; }
  if (draft.kind !== 'asset' && draft.kind !== 'liability') { return 'Choose asset or liability.'; }
  if (!DECIMAL.test(draft.quantity)) { return 'Enter an exact nonnegative quantity, with up to 18 decimal places.'; }
  if (draft.unitPrice && !DECIMAL.test(draft.unitPrice)) { return 'Enter an exact nonnegative unit price, or leave it blank.'; }
  if (draft.unitPrice && !/^[A-Z][A-Z0-9]{1,11}$/.test(draft.quoteCurrency.trim().toUpperCase())) {
    return 'Enter the currency of your unit price, such as USD.';
  }
  if (draft.quoteCurrency.trim() && !/^[A-Z][A-Z0-9]{1,11}$/.test(draft.quoteCurrency.trim().toUpperCase())) {
    return 'Use a currency label of 2 to 12 letters or digits.';
  }
  const parsed = Date.parse(draft.effectiveAt + 'T00:00:00.000Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveAt) || !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== draft.effectiveAt) { return 'Choose a valid effective date.'; }
  return null;
}

export function manualPositionValue(entry: Pick<LocalManualEntry, 'quantity' | 'unitPrice'>): string | null {
  if (!DECIMAL.test(entry.quantity) || !entry.unitPrice || !DECIMAL.test(entry.unitPrice)) { return null; }
  const decimals = (entry.quantity.split('.')[1]?.length ?? 0) + (entry.unitPrice.split('.')[1]?.length ?? 0);
  const product = BigInt(entry.quantity.replace('.', '')) * BigInt(entry.unitPrice.replace('.', ''));
  if (decimals === 0) { return product.toString(); }
  const digits = product.toString().padStart(decimals + 1, '0');
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  return digits.slice(0, -decimals) + (fraction ? '.' + fraction : '');
}
