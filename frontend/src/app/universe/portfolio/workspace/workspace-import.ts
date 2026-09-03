import { looksSecretLike } from '@app/shared/secret-detection';
import {
  MAXIMUM_GROUP_LENGTH,
  MAXIMUM_LABEL_LENGTH,
  sanitizeLabel,
} from '@app/universe/portfolio/portfolio-watchlist.service';

/**
 * Bringing a watchlist in, and keeping out everything that must not come in.
 *
 * A visitor arrives with a file of addresses from a previous tool or a
 * backup. The importer reads CSV or JSON, keeps one valid watched address
 * per row, and states plainly what it rejected and why. Two refusals are
 * absolute: text that looks like key material is never read into the
 * workspace at all, and a row the grammar cannot validate is named in the
 * rejection list rather than dropped silently.
 */

export const MAXIMUM_IMPORT_ROWS = 200;

export interface ImportEntry {
  readonly chain: string;
  readonly network: string;
  readonly address: string;
  readonly label: string;
  readonly group: string;
}

export interface ImportRejection {
  readonly row: number;
  readonly reason: string;
}

export interface ImportResult {
  readonly entries: ImportEntry[];
  readonly rejections: ImportRejection[];
}

const CHAIN = /^[a-z][a-z0-9-]{0,31}$/;
const NETWORK = /^[a-z][a-z0-9-]{0,31}$/;
const ADDRESS = /^[0-9A-Za-z]{10,256}$/;

/** True for input that must never enter the workspace. */
export function isSecretLike(text: string): boolean {
  return looksSecretLike(text);
}

/**
 * Imports CSV text: one row per address. A header naming the columns is
 * detected and skipped; rejection rows count data rows, header excluded.
 */
export function importCsv(text: string): ImportResult {
  const rows = splitCsvRows(text ?? '');
  if (rows.length && String(rows[0][0] ?? '').trim().toLowerCase() === 'address') {
    rows.shift();
  }
  return importRows(rows.map((row) => ({ address: row[0] ?? '', chain: row[1] ?? '', network: row[2] ?? '', label: row[3] ?? '', group: row[4] ?? '' })));
}

/** Imports JSON text: an array of entries, each shaped like a watch row. */
export function importJson(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text ?? '');
  } catch {
    return { entries: [], rejections: [{ row: 0, reason: 'The file is not valid JSON.' }] };
  }
  if (!Array.isArray(parsed)) {
    return { entries: [], rejections: [{ row: 0, reason: 'The file holds no list of addresses.' }] };
  }
  return importRows(parsed as unknown[]);
}

function importRows(rows: unknown[]): ImportResult {
  const entries: ImportEntry[] = [];
  const rejections: ImportRejection[] = [];
  const seen = new Set<string>();

  rows.slice(0, MAXIMUM_IMPORT_ROWS + 1).forEach((row, index) => {
    if (entries.length >= MAXIMUM_IMPORT_ROWS) {
      rejections.push({ row: index + 1, reason: `Past the ${MAXIMUM_IMPORT_ROWS} row limit.` });
      return;
    }
    const record = asRecord(row);
    if (!record) {
      rejections.push({ row: index + 1, reason: 'Not a readable row.' });
      return;
    }
    const address = String(record.address ?? '').trim();
    const chain = String(record.chain ?? 'bitcoin').trim().toLowerCase() || 'bitcoin';
    const network = String(record.network ?? 'mainnet').trim().toLowerCase() || 'mainnet';

    if (isSecretLike(address)) {
      rejections.push({ row: index + 1, reason: 'Looks like key material. It was not read in.' });
      return;
    }
    if (!ADDRESS.test(address)) {
      rejections.push({ row: index + 1, reason: 'The address is not the shape of an address.' });
      return;
    }
    if (!CHAIN.test(chain)) {
      rejections.push({ row: index + 1, reason: `Unknown chain "${chain}".` });
      return;
    }
    if (!NETWORK.test(network)) {
      rejections.push({ row: index + 1, reason: `Unknown network "${network}".` });
      return;
    }
    const key = `${chain}:${network}:${address}`;
    if (seen.has(key)) {
      rejections.push({ row: index + 1, reason: 'A duplicate of an earlier row.' });
      return;
    }
    seen.add(key);
    entries.push({
      address,
      chain,
      network,
      label: sanitizeLabel(record.label ?? '', MAXIMUM_LABEL_LENGTH),
      group: sanitizeLabel(record.group ?? '', MAXIMUM_GROUP_LENGTH),
    });
  });

  if (rows.length > MAXIMUM_IMPORT_ROWS) {
    rejections.push({ row: MAXIMUM_IMPORT_ROWS + 1, reason: `Rows past ${MAXIMUM_IMPORT_ROWS} were not read.` });
  }

  return { entries, rejections };
}

function asRecord(row: unknown): Record<string, unknown> | null {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    return row as Record<string, unknown>;
  }
  if (Array.isArray(row)) {
    return { address: row[0], chain: row[1], network: row[2], label: row[3], group: row[4] };
  }
  return null;
}

/** Splits CSV lines, honoring quoted fields; no parser dependencies. */
function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;

  const endField = (): void => {
    fields.push(field);
    field = '';
  };
  const endRow = (): void => {
    if (!sawAny && fields.every((value) => value === '')) {
      fields = [];
      return;
    }
    endField();
    rows.push(fields);
    fields = [];
    sawAny = false;
  };

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    sawAny = true;
    if (inQuotes) {
      if (character === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') { inQuotes = true; continue; }
    if (character === ',') { endField(); sawAny = true; continue; }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && text[i + 1] === '\n') { i++; }
      endRow();
      continue;
    }
    field += character;
  }
  if (field !== '' || fields.length) { endRow(); }
  return rows;
}
