/**
 * Bytes a person can read.
 *
 * Storage reports arrive in bytes. A visitor deciding whether to keep or
 * delete stored data needs megabytes and gigabytes, stated the same way every
 * time, with the honest word for a number the browser would not give.
 */

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return 'unknown';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) { break; }
    value /= 1024;
    unit = next;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${unit}`;
}

/** One sentence about how much of the browser allowance is in use. */
export function storageSentence(usageBytes: number | null, quotaBytes: number | null): string {
  if (usageBytes === null) {
    return 'The browser did not report how much is stored.';
  }
  if (quotaBytes === null) {
    return `${formatBytes(usageBytes)} stored.`;
  }
  const percent = quotaBytes > 0 ? Math.round((usageBytes / quotaBytes) * 100) : 0;
  return `${formatBytes(usageBytes)} stored of about ${formatBytes(quotaBytes)} the browser allows (${percent}%).`;
}
