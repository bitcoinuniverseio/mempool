/** Exact nonnegative percentage, truncated at eight decimal places. */
export function exactPercentage(part: string | null, total: string | null): string | null {
  const valid = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 && /^\d+(\.\d+)?$/.test(value);
  if (!valid(part) || !valid(total)) return null;
  const [pWhole, pFraction = ''] = part.split('.');
  const [tWhole, tFraction = ''] = total.split('.');
  const scale = Math.max(pFraction.length, tFraction.length);
  const numerator = BigInt(pWhole + pFraction.padEnd(scale, '0'));
  const denominator = BigInt(tWhole + tFraction.padEnd(scale, '0'));
  if (denominator === 0n) return null;
  const units = numerator * 10_000_000_000n / denominator;
  const fraction = (units % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return (units / 100_000_000n).toString() + (fraction ? '.' + fraction : '');
}
