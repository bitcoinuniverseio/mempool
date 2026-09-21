/**
 * How an asset quantity is turned into something a person can read, shared by
 * the transaction summary and the address holdings panel.
 *
 * Every function here is pure and works on strings. That is not a style
 * preference: an asset quantity is an unsigned integer of arbitrary size in the
 * asset's smallest unit, and a rune supply routinely exceeds what a JavaScript
 * number can hold. Converting one to a number to divide it by its divisibility
 * loses digits silently, and the digit it loses is a digit of somebody's
 * balance. Nothing in this file constructs a Number from a quantity.
 *
 * Three facts have to survive into the view, and each has its own case rather
 * than a falsy check:
 *
 * - A known quantity with known divisibility is an exact decimal.
 * - A known quantity with unknown divisibility is still exactly true as digits,
 *   and is labelled as smallest units. Scaling it by a guessed divisibility
 *   would understate it by up to thirty eight orders of magnitude.
 * - An unknown quantity is unknown. It is not zero, and zero is not unknown.
 *
 * A long exact value also gets an explicitly approximate short form, so a
 * column stays readable without a person ever being shown a rounded number they
 * might mistake for the real one. The approximation is marked, the exact value
 * is always available, and what gets copied is always the exact value.
 */

/** The largest divisibility the contract allows. */
const MAX_DECIMALS = 38;
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/;

/**
 * How many characters a primary quantity may occupy before it is shortened.
 *
 * Chosen from the layout rather than from the value: a bounded numeric column
 * at the narrowest supported width fits about this many tabular digits, and a
 * primary quantity must never wrap.
 */
export const COMPACT_THRESHOLD = 12;

/** The short scale suffixes, paired with the power of ten each stands for. */
const MAGNITUDES: readonly { readonly power: number; readonly suffix: string }[] =
  [
    { power: 12, suffix: 'T' },
    { power: 9, suffix: 'B' },
    { power: 6, suffix: 'M' },
    { power: 3, suffix: 'K' },
  ];

export type QuantityKind = 'exact' | 'raw' | 'unknown';

/**
 * One quantity, ready to render.
 *
 * `headline` is what the column shows and `exact` is what a disclosure shows
 * and what a copy action puts on the clipboard. When `approximate` is true the
 * two differ and the view must say so; when it is false they are the same
 * string and there is nothing to disclose.
 */
export interface PresentedQuantity {
  readonly kind: QuantityKind;
  /** The short form for the column. Empty only when the kind is unknown. */
  readonly headline: string;
  /** The complete value, never shortened. Empty only when kind is unknown. */
  readonly exact: string;
  /** True when `headline` is a rounded stand-in for `exact`. */
  readonly approximate: boolean;
  /**
   * True when the side this came from was only partly proven, so the value is
   * a floor rather than a total.
   */
  readonly partial: boolean;
}

export const UNKNOWN_QUANTITY: PresentedQuantity = {
  kind: 'unknown',
  headline: '',
  exact: '',
  approximate: false,
  partial: false,
};

/**
 * The exact decimal form of an atomic quantity, or null when divisibility is
 * not known.
 *
 * Null is the instruction to label the digits as smallest units. It never means
 * zero and never licenses treating the digits as whole units.
 */
export function exactDecimal(
  quantityAtomic: string | null,
  decimals: number | null,
): string | null {
  if (quantityAtomic === null || decimals === null) return null;
  if (!UNSIGNED_INTEGER.test(quantityAtomic)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    return null;
  }
  if (decimals === 0) return quantityAtomic;
  const padded = quantityAtomic.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return fraction.length === 0 ? whole : whole + '.' + fraction;
}

/** Thousands separators, by string surgery on the integer part only. */
export function groupIntegerDigits(value: string): string {
  const point = value.indexOf('.');
  const whole = point === -1 ? value : value.slice(0, point);
  const rest = point === -1 ? '' : value.slice(point);
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + rest;
}

/**
 * A short, explicitly approximate form of a decimal string, or null when the
 * value already fits.
 *
 * Accepts the grouped display string, because the column's width is what
 * decides whether shortening is needed, but computes on the digits: a comma is
 * not a digit and treating it as one mis-measures every magnitude.
 *
 * Returning null is meaningful. It says the value printed in full, so nothing
 * in the view should suggest the reader is looking at a rounded number.
 *
 * A very small nonzero value never becomes zero. Rounding 0.00000001 down to
 * "0" would state that an address holds none of an asset it holds some of, so
 * a value too small to place positionally is given in exponent form instead,
 * which stays short, stays nonzero, and cannot be misread as the exact value.
 */
export function compactDecimal(exact: string): string | null {
  if (exact.length <= COMPACT_THRESHOLD) return null;
  const value = exact.replace(/,/g, '');
  const point = value.indexOf('.');
  const whole = point === -1 ? value : value.slice(0, point);
  const fraction = point === -1 ? '' : value.slice(point + 1);

  if (whole !== '0' && whole !== '') {
    for (const magnitude of MAGNITUDES) {
      if (whole.length <= magnitude.power) continue;
      const cut = whole.length - magnitude.power;
      // More than three digits ahead of the largest suffix means the suffix
      // cannot shorten it enough, and an exponent is the honest short form.
      if (cut > 3) break;
      const head = whole.slice(0, cut);
      const tail = whole.slice(cut, cut + 2).replace(/0+$/, '');
      return head + (tail.length > 0 ? '.' + tail : '') + magnitude.suffix;
    }
    if (whole.length > MAGNITUDES[0].power) return exponentForm(whole, 0);
    // A short whole part with a long fraction: the fraction is the only part
    // that can be cut, and the whole part is never touched.
    const room = COMPACT_THRESHOLD - whole.length - 1;
    const kept = room > 0 ? fraction.slice(0, room) : '';
    return kept.length > 0 ? whole + '.' + kept : whole;
  }

  // A pure fraction. Show it positionally while that fits, so a small holding
  // stays legible, and fall back to an exponent rather than to zero.
  const leadingZeros = fraction.length - fraction.replace(/^0+/, '').length;
  const significant = fraction.slice(leadingZeros, leadingZeros + 3);
  if (significant.length === 0) return '0';
  if (leadingZeros + significant.length <= COMPACT_THRESHOLD - 2) {
    return '0.' + '0'.repeat(leadingZeros) + significant;
  }
  return exponentForm(significant, -(leadingZeros + 1));
}

/**
 * Three significant digits and a power of ten, for a value no positional form
 * can show in the space available.
 */
function exponentForm(digits: string, exponentOfFirstDigit: number): string {
  const significant = digits.replace(/^0+/, '');
  const exponent =
    exponentOfFirstDigit === 0 ? digits.length - 1 : exponentOfFirstDigit;
  const lead = significant.slice(0, 1) || '0';
  const rest = significant.slice(1, 3).replace(/0+$/, '');
  return lead + (rest.length > 0 ? '.' + rest : '') + 'e' + String(exponent);
}

/**
 * The presented form of one side's quantity.
 *
 * `complete` is the authority's statement that it accounted for every position
 * on that side. A false value does not make the quantity wrong, it makes it a
 * floor, which the view has to say.
 */
export function presentQuantity(
  quantityAtomic: string | null,
  decimals: number | null,
  complete = true,
): PresentedQuantity {
  if (quantityAtomic === null || !UNSIGNED_INTEGER.test(quantityAtomic)) {
    return { ...UNKNOWN_QUANTITY, partial: !complete };
  }
  const decimal = exactDecimal(quantityAtomic, decimals);
  if (decimal === null) {
    // Divisibility unknown or conflicted. The digits are exactly true; only
    // their scale is unknown, so they are shown and labelled, never scaled.
    const grouped = groupIntegerDigits(quantityAtomic);
    const short = compactDecimal(grouped);
    return {
      kind: 'raw',
      headline: short ?? grouped,
      exact: quantityAtomic,
      approximate: short !== null,
      partial: !complete,
    };
  }
  const grouped = groupIntegerDigits(decimal);
  const short = compactDecimal(grouped);
  return {
    kind: 'exact',
    headline: short ?? grouped,
    exact: decimal,
    approximate: short !== null,
    partial: !complete,
  };
}

/**
 * One or two letters standing in for a missing logo.
 *
 * A labelled placeholder in the protocol's own hue reads as a deliberate
 * stand-in. An empty grey square reads as an image that failed to load, and
 * neither may be mistaken for a verified token logo.
 */
export function initialsFor(...candidates: readonly string[]): string {
  const source = candidates.find((candidate) => candidate && candidate.trim());
  const trimmed = (source ?? '?').trim();
  const words = trimmed.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length > 1
      ? words[0].charAt(0) + words[1].charAt(0)
      : trimmed.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * A shortened identifier for a column, with the ends kept.
 *
 * The ends are what a person compares against another identifier, so the
 * middle is what goes. The full value always stays available elsewhere; this is
 * presentation only and is never what gets copied.
 */
export function shortenAssetId(value: string, keep = 6): string {
  if (typeof value !== 'string') return '';
  if (value.length <= keep * 2 + 1) return value;
  return value.slice(0, keep) + '…' + value.slice(value.length - keep);
}
