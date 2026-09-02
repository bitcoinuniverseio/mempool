import { CommandCandidate } from './command-candidates';

/**
 * Batch lookup, bounded on purpose.
 *
 * A visitor with forty identifiers needs them resolved as a set, not one at
 * a time, and a service that would happily resolve forty thousand needs to
 * exist behind a different product. The bound here is stated to the visitor
 * when they hit it, not applied silently, and a batch in flight can be
 * stopped.
 */

/** The most lines one batch resolves. */
export const MAXIMUM_BATCH = 25;

/** Splits pasted text into batch lines: trimmed, non empty, bounded. */
export function splitBatch(text: string): { lines: string[]; dropped: number } {
  const lines = (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length <= MAXIMUM_BATCH) {
    return { lines, dropped: 0 };
  }
  return { lines: lines.slice(0, MAXIMUM_BATCH), dropped: lines.length - MAXIMUM_BATCH };
}

export interface BatchRow {
  readonly value: string;
  readonly candidates: readonly CommandCandidate[];
  /** What the row says when nothing was recognized. */
  readonly note: string | null;
}

/** One row per value, with whatever the local grammar can say about it. */
export function batchRow(value: string, candidates: readonly CommandCandidate[]): BatchRow {
  if (candidates.length) {
    return { value, candidates, note: null };
  }
  return {
    value,
    candidates: [],
    note: 'Nothing here could identify it.',
  };
}

const CSV_COLUMNS = ['value', 'kind', 'chain', 'path', 'source', 'exact'] as const;

function csvField(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV: one row per candidate, so a spreadsheet filters the same way the page did. */
export function batchCsv(rows: readonly BatchRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    if (!row.candidates.length) {
      lines.push([row.value, '', '', '', '', 'false'].map(csvField).join(','));
      continue;
    }
    for (const candidate of row.candidates) {
      lines.push([
        row.value,
        candidate.kind,
        candidate.chain ?? '',
        candidate.path,
        candidate.source,
        String(candidate.exact),
      ].map(csvField).join(','));
    }
  }
  return `${lines.join('\n')}\n`;
}

/** JSON: the rows exactly as the page held them. */
export function batchJson(rows: readonly BatchRow[]): string {
  return JSON.stringify({
    schemaVersion: 'universe-command-batch-v1',
    rows,
  }, null, 2);
}
