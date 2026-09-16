export function blockspaceValue(value: unknown, unit = ''): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) + (unit ? ' ' + unit : '') : 'Unknown';
}
export function blockspaceShare(part: unknown, total: unknown): string {
  return typeof part === 'number' && Number.isFinite(part) && part >= 0 && typeof total === 'number' && Number.isFinite(total) && total > 0 ? (part / total * 100).toFixed(1) + '%' : 'Unknown';
}
export function blockspaceBtc(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? (value / 100000000).toFixed(8) + ' BTC' : 'Unknown';
}
