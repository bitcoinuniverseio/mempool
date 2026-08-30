/**
 * Dunes, read from the ord-dogecoin authority's catalog.
 *
 * A dune's arithmetic is 128-bit and each dune carries its own
 * `divisibility`, so nothing here shares a rule with Dogecoin's eight
 * decimals. The same three rules that hold the ruleset reading hold this
 * one:
 *
 * - **Quantities are shifted by the dune's own divisibility, and the kinds
 *   are an allowlist.** A supply of `100000000000000000` is a hundred
 *   million with divisibility eight and a hundred quadrillion with zero,
 *   and `mints` is a number of mint events that must never be shifted at
 *   all.
 * - **A field this build has no kind for is named, not dropped.**
 * - **A dune whose divisibility cannot be read shows no shifted quantity at
 *   all**, because an unshifted figure presented as one is wrong by a
 *   factor the reader cannot see.
 */

import {
  ExactNumber,
  formatAtomicAmount,
  formatUnixTimestamp,
  humanizeFieldName,
} from './multichain-view';
import { readDecimals } from './ruleset-assets';

/** What a dune figure is, so it is never shifted by the wrong rule. */
export type DuneFigureKind =
  /** A quantity of the dune, stated in its smallest unit. */
  | 'amount'
  /** A number of things. Never shifted by divisibility. */
  | 'count';

/**
 * An allowlist, because a pattern is how the wrong field gets matched.
 * Every entry here was read from the authority contract for
 * `/dogecoin/protocols/dunes`.
 */
const DUNE_FIGURE_KIND: Record<string, DuneFigureKind> = {
  supplyAtomic: 'amount',
  premineAtomic: 'amount',
  burnedAtomic: 'amount',
  mintsAtomic: 'count',
  numberAtomic: 'count',
  etchedHeightAtomic: 'count',
};

/**
 * Fields the reading presents in its own designed places rather than as
 * figures: the name, the identifier, the glyph, the shift itself, the
 * etching transaction, the timestamp, and the mintability verdict.
 */
const PRESENTED_DUNE_FIELDS = new Set([
  'dune',
  'duneId',
  'symbol',
  'divisibilityAtomic',
  'etchingTxid',
  'etchedTimestampAtomic',
  'mintable',
]);

export interface DuneFigure {
  readonly key: string;
  readonly label: string;
  readonly kind: DuneFigureKind;
  readonly value: ExactNumber | null;
}

export interface DuneAssetReading {
  readonly dune: string;
  readonly duneId: string;
  /** The dune's display glyph, or null when none was etched. */
  readonly symbol: string | null;
  /** Stated once and prominently: it is what every quantity was shifted by. */
  readonly divisibility: number | null;
  readonly divisibilityExact: string | null;
  readonly etchingTxid: string | null;
  readonly etchedAt: ExactNumber | null;
  /** Whether the terms allow a mint in the next block. Null when unstated. */
  readonly mintable: boolean | null;
  readonly figures: readonly DuneFigure[];
  /**
   * Fields this build carries no kind for. Named, so a figure that is in
   * the response and not on the page is visible as an omission rather than
   * as an absence.
   */
  readonly unreadFields: readonly string[];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One dune, read from an item carrying a spaced name and a divisibility.
 *
 * Returns null for anything without both, so a payload that is not this
 * shape falls through to the reading it already had.
 */
export function readDuneAsset(item: unknown): DuneAssetReading | null {
  if (!isRecord(item)) {
    return null;
  }
  const dune = text(item.dune);
  const divisibilityExact = text(item.divisibilityAtomic);
  if (dune === null || divisibilityExact === null) {
    return null;
  }
  const divisibility = readDecimals(item.divisibilityAtomic);

  const figures: DuneFigure[] = [];
  const unread: string[] = [];
  for (const [key, value] of Object.entries(item)) {
    if (PRESENTED_DUNE_FIELDS.has(key)) {
      continue;
    }
    const kind = DUNE_FIGURE_KIND[key];
    if (!kind) {
      unread.push(key);
      continue;
    }
    const precision = kind === 'amount' ? divisibility : 0;
    figures.push({
      key,
      label: humanizeFieldName(key.replace(/Atomic$/, '')),
      kind,
      value: precision === null ? null : formatAtomicAmount(text(value), precision),
    });
  }

  return {
    dune,
    duneId: text(item.duneId) ?? '',
    symbol: text(item.symbol),
    divisibility,
    divisibilityExact,
    etchingTxid: text(item.etchingTxid),
    etchedAt: formatUnixTimestamp(text(item.etchedTimestampAtomic)),
    mintable: typeof item.mintable === 'boolean' ? item.mintable : null,
    figures,
    unreadFields: unread,
  };
}

// ---------------------------------------------------------------------------
// The list page
// ---------------------------------------------------------------------------

/**
 * The figure columns the list table shows, in this order, when a row
 * carries them. Every other figure is on the dune's own page, and the
 * columns the table is holding back are named beside it.
 */
const DUNE_LIST_COLUMNS = ['supplyAtomic', 'mintsAtomic', 'burnedAtomic'];

export interface DuneListColumn {
  readonly key: string;
  readonly label: string;
}

export interface DuneAssetListRow {
  readonly reading: DuneAssetReading;
  /** One cell per column. Null where this dune has no such figure. */
  readonly cells: readonly { key: string; figure: DuneFigure | null }[];
}

export interface DuneAssetListReading {
  readonly columns: readonly DuneListColumn[];
  readonly rows: readonly DuneAssetListRow[];
  readonly shownCount: number;
  /** The authority's own total, exactly as sent. Null when it sent none. */
  readonly totalExact: string | null;
  /** Figure fields present in the rows that are not columns here. Named. */
  readonly hiddenFigureFields: readonly string[];
  /** Items in the response this reading could not read as dunes. */
  readonly unreadRowCount: number;
}

/**
 * A page of dunes, each carrying its own divisibility.
 *
 * Returns null for a payload without a `dunes` array of such items, so
 * everything else keeps the reading it already had.
 */
export function readDuneAssetList(payload: unknown): DuneAssetListReading | null {
  if (!isRecord(payload) || !Array.isArray(payload.dunes) || !payload.dunes.length) {
    return null;
  }
  const rows: DuneAssetReading[] = [];
  let unreadRowCount = 0;
  for (const item of payload.dunes) {
    const reading = readDuneAsset(item);
    if (reading) {
      rows.push(reading);
    } else {
      unreadRowCount += 1;
    }
  }
  if (!rows.length) {
    return null;
  }

  const present = new Set<string>();
  for (const reading of rows) {
    for (const figure of reading.figures) {
      present.add(figure.key);
    }
  }
  const columns = DUNE_LIST_COLUMNS.filter((key) => present.has(key)).map(
    (key) => ({
      key,
      label: humanizeFieldName(key.replace(/Atomic$/, '')),
    })
  );
  const hiddenFigureFields = [...present]
    .filter((key) => !DUNE_LIST_COLUMNS.includes(key))
    .map((key) => humanizeFieldName(key.replace(/Atomic$/, '')));

  return {
    columns,
    rows: rows.map((reading) => ({
      reading,
      cells: columns.map((column) => ({
        key: column.key,
        figure:
          reading.figures.find((figure) => figure.key === column.key) ?? null,
      })),
    })),
    shownCount: rows.length,
    totalExact: text(payload.totalCountAtomic),
    hiddenFigureFields,
    unreadRowCount,
  };
}

/**
 * The detail payload: one dune under a `dune` key beside the checkpoint.
 * The list payload's `dunes` array does not match this, and an item alone
 * does not carry the key, so the two readings never claim each other's
 * payloads.
 */
export function readDuneAssetDetail(payload: unknown): DuneAssetReading | null {
  if (!isRecord(payload) || !isRecord(payload.dune)) {
    return null;
  }
  return readDuneAsset(payload.dune);
}
