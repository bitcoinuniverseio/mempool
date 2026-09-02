/**
 * Exact-value presentation helpers for Portfolio Intelligence.
 *
 * Blockchain quantities and monetary values arrive as exact decimal
 * strings and never pass through floating point. These helpers shift the
 * decimal point with string arithmetic, format for humans, and produce
 * masked renderings for privacy mode - always returning strings a
 * template can bind directly.
 */

const MAX_SAFE_FRACTION = 12;

/** Atomic exact decimal → display exact decimal string, or null. */
export function atomicToDisplay(
  quantityAtomic: string | null | undefined,
  decimals: number | null | undefined,
): string | null {
  if (quantityAtomic === null || quantityAtomic === undefined) return null;
  if (!/^-?\d+(\.\d+)?$/.test(quantityAtomic)) return null;
  const scale = decimals ?? 0;
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) return null;
  const negative = quantityAtomic.startsWith('-');
  // Treat the whole digit string as the atomic integer and insert the
  // decimal point `scale` digits from the right.
  const digits = (negative ? quantityAtomic.slice(1) : quantityAtomic).replace('.', '');
  const padded = digits.padStart(scale + 1, '0');
  const displayWhole = padded.slice(0, padded.length - scale);
  const displayFraction = padded.slice(padded.length - scale).replace(/0+$/, '');
  const joined =
    displayFraction.length === 0 ? displayWhole : `${displayWhole}.${displayFraction}`;
  return negative ? `-${joined}` : joined;
}

/** Display exact decimal → atomic exact decimal string, or null. */
export function displayToAtomic(
  quantity: string,
  decimals: number,
): string | null {
  if (!/^-?\d+(\.\d+)?$/.test(quantity)) return null;
  const negative = quantity.startsWith('-');
  const digits = negative ? quantity.slice(1) : quantity;
  const [whole, fraction = ''] = digits.split('.');
  if (fraction.length > MAX_SAFE_FRACTION + 6) return null;
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  const atomic = (whole === '' ? '0' : whole) + padded;
  const trimmed = atomic.replace(/^0+(?=\d)/, '');
  return negative ? `-${trimmed}` : trimmed;
}

export interface FormatOptions {
  /** Maximum fraction digits shown; exact value stays available via title. */
  readonly maximumFractionDigits?: number;
  readonly minimumFractionDigits?: number;
}

/**
 * Human formatting of an exact decimal string using Intl, grouped with
 * tabular-friendly digits. The input never becomes a float: digits are
 * regrouped as a string before Intl formats the two sides.
 */
export function formatExact(
  value: string | null | undefined,
  locale: string,
  options: FormatOptions = {},
): string {
  if (value === null || value === undefined || !/^-?\d+(\.\d+)?$/.test(value)) {
    return '-';
  }
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = digits.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f'); // narrow no-break space
  const max = options.maximumFractionDigits;
  const min = options.minimumFractionDigits ?? 0;
  let fractionText = fraction;
  if (max !== undefined) {
    fractionText = fraction.slice(0, max);
    if (fractionText.length < min) fractionText = fraction.padEnd(min, '0');
  }
  const sign = negative ? '-' : '';
  return fractionText.length === 0
    ? `${sign}${grouped}`
    : `${sign}${grouped}.${fractionText}`;
}

/** Exact signed comparison on decimal strings. */
export function compareExact(a: string, b: string): number {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const left = scaledUnits(a, scale);
  const right = scaledUnits(b, scale);
  return left === right ? 0 : left < right ? -1 : 1;
}

/** True when the exact value is greater than zero. */
export function isPositiveExact(value: string | null | undefined): boolean {
  if (value === null || value === undefined || !/^-?\d+(\.\d+)?$/.test(value)) {
    return false;
  }
  return BigInt(value.replace('.', '')) > 0n;
}

function scaleOf(value: string): number {
  const fraction = value.split('.')[1];
  return fraction?.length ?? 0;
}

function scaledUnits(value: string, scale: number): bigint {
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = digits.split('.');
  const units = BigInt((whole + fraction.padEnd(scale, '0')) || '0');
  return negative ? -units : units;
}

/**
 * Sums exact decimal strings with BigInt. Returns null when any member is
 * malformed rather than presenting a partial sum as a whole.
 */
export function sumExact(values: readonly (string | null | undefined)[]): string | null {
  let scale = 0;
  for (const value of values) {
    if (value === null || value === undefined || !/^-?\d+(\.\d+)?$/.test(value)) {
      return null;
    }
    scale = Math.max(scale, scaleOf(value));
  }
  let total = 0n;
  for (const value of values as readonly string[]) {
    total += scaledUnits(value, scale);
  }
  if (scale === 0) return total.toString();
  const negative = total < 0n;
  const text = (negative ? -total : total).toString().padStart(scale + 1, '0');
  const whole = text.slice(0, text.length - scale);
  const fraction = text.slice(text.length - scale).replace(/0+$/, '');
  const joined = fraction.length === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${joined}` : joined;
}

/**
 * Truncates an address for display with both ends visible. Privacy mode
 * replaces the whole value instead; this helper is for normal display.
 */
export function truncateIdentifier(
  value: string,
  head = 8,
  tail = 6,
): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * The masked rendering used by privacy mode: a fixed-shape placeholder
 * that leaks neither magnitude nor currency. Screen readers announce it
 * as "hidden", and it contains no information to reconstruct.
 */
export const PRIVACY_MASK = '••••';

/** Hides a formatted value for privacy mode. */
export function maskedValue(): string {
  return PRIVACY_MASK;
}
