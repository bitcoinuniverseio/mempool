/**
 * Assets whose ledger is reported under more than one reading of the rules.
 *
 * ZRC-20 is the case this exists for. The authority indexes every token twice,
 * once under `zord` and once under `zecscriptions`, publishes both ledgers, and
 * names the fields the two disagree on. It also publishes prose about rules
 * that neither reading evaluates, and why.
 *
 * None of it reached a page. `rulesets` is an object of objects, so the generic
 * fact reader stopped one level above the figures and the table could not hold
 * a structure at all. The whole ledger for all 159 tokens was a field the page
 * declined to show.
 *
 * Three rules hold this reading:
 *
 * - **Quantities are shifted by the token's own `decimals`, and the kinds are
 *   an allowlist.** A pattern over field names is what printed a DRC-20 supply
 *   of `100000000000` as `1,000 DOGE`, by matching a field that was not an
 *   amount. Here the opposite mistake is available: `max_supply` of
 *   `21000000000000000000000000` is twenty-one million with eighteen decimals
 *   applied and twenty-one septillion without, and `holders` must never be
 *   shifted at all.
 * - **A field this build has no kind for is named, not dropped.** That is the
 *   defect this reading exists to fix, and reproducing it one level down would
 *   be worse for being deliberate.
 * - **Where the readings disagree, both figures are shown.** Choosing one and
 *   presenting it as the answer would be the explorer inventing a consensus
 *   the chain does not have.
 */

import { ExactNumber, formatAtomicAmount, humanizeFieldName } from './multichain-view';

/** What a ruleset field is, so it is never shifted by the wrong rule. */
export type FigureKind =
  /** A quantity of the token, stated in its smallest unit. */
  | 'amount'
  /** A number of things. Never shifted by decimals. */
  | 'count'
  /** A word the authority chose. */
  | 'word';

/**
 * An allowlist, because a pattern is how the wrong field gets matched. Every
 * entry here was read from a live `/api/v1/zcash/protocols/zrc20` response.
 */
const FIGURE_KIND: Record<string, FigureKind> = {
  max_supply: 'amount',
  mint_limit: 'amount',
  minted: 'amount',
  burned: 'amount',
  shielded: 'amount',
  circulating: 'amount',
  mint_count: 'count',
  holders: 'count',
  status: 'word',
};

/**
 * `mint_progress` restates `minted` and `max_supply`, both of which are already
 * figures of their own. Skipped by name rather than left to fall through the
 * unknown-field path, so it is not reported as something this build cannot read
 * when there is nothing in it the page does not already show.
 */
const RESTATED_FIELDS = new Set(['mint_progress']);

/** One figure, as each reading of the rules reports it. */
export interface RulesetFigure {
  readonly key: string;
  readonly label: string;
  readonly kind: FigureKind;
  /** Lens ruleset first. Every entry is present even when they agree. */
  readonly readings: readonly {
    ruleset: string;
    amount: ExactNumber | null;
    word: string | null;
  }[];
  /** True when the readings do not report the same value. */
  readonly diverges: boolean;
}

/** A rule the authority states that no reading of the rules evaluates. */
export interface UnevaluatedRule {
  readonly id: string;
  readonly summary: string;
  readonly reason: string;
}

export interface RulesetAssetReading {
  readonly tick: string;
  /**
   * Stated once and prominently rather than per row. It is the field that makes
   * every other number mean anything, and being identical on every row is
   * exactly why a table drops it.
   */
  readonly decimals: number | null;
  readonly decimalsExact: string | null;
  /** The reading the authority serves by default. */
  readonly lens: string | null;
  readonly rulesets: readonly string[];
  readonly figures: readonly RulesetFigure[];
  /** Fields whose readings differ, observed from the figures themselves. */
  readonly divergingFields: readonly string[];
  /** Fields the authority says diverge. Its claim, checked against the above. */
  readonly statedDivergingFields: readonly string[];
  /** Rulesets the authority says do not carry this asset at all. */
  readonly absentFrom: readonly string[];
  readonly unevaluated: readonly UnevaluatedRule[];
  /**
   * Ruleset fields this build carries no kind for. Named, so a figure that is
   * in the response and not on the page is visible as an omission rather than
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
 * `decimals` as a number, or null.
 *
 * Anything that is not a plain non-negative integer within the shift's
 * supported range is refused rather than coerced, because a wrong shift is a
 * wrong quantity and there is no partial credit for being close.
 */
export function readDecimals(value: unknown): number | null {
  const digits = text(value);
  if (digits === null || !/^(0|[1-9][0-9]*)$/.test(digits)) {
    return null;
  }
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) && parsed <= 38 ? parsed : null;
}

/**
 * One asset, read from an item carrying a `rulesets` object.
 *
 * Returns null for anything without one, so a payload that is not this shape
 * falls through to the reading it already had.
 */
export function readRulesetAsset(
  item: unknown,
  lens: string | null
): RulesetAssetReading | null {
  if (!isRecord(item) || !isRecord(item.rulesets)) {
    return null;
  }
  const table = item.rulesets as Record<string, unknown>;
  const names = Object.keys(table).filter((name) => isRecord(table[name]));
  if (!names.length) {
    return null;
  }

  // Lens first, so the reading the authority serves by default is the one a
  // visitor reads first and the others sit beside it rather than replacing it.
  const ordered =
    lens && names.includes(lens) ? [lens, ...names.filter((name) => name !== lens)] : names;

  const decimalsExact = text(item.decimals);
  const decimals = readDecimals(item.decimals);

  const keys: string[] = [];
  const unread: string[] = [];
  for (const name of ordered) {
    for (const key of Object.keys(table[name] as Record<string, unknown>)) {
      if (RESTATED_FIELDS.has(key)) {
        continue;
      }
      if (!FIGURE_KIND[key]) {
        if (!unread.includes(key)) {
          unread.push(key);
        }
        continue;
      }
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }

  const figures: RulesetFigure[] = keys.map((key) => {
    const kind = FIGURE_KIND[key];
    const readings = ordered.map((ruleset) => {
      const source = text((table[ruleset] as Record<string, unknown>)[key]);
      if (kind === 'word') {
        return { ruleset, amount: null, word: source };
      }
      // A count is a number of things and is never shifted. An amount is a
      // quantity of the token and is always shifted by that token's own
      // decimals, which is why a token whose decimals could not be read shows
      // no amount at all rather than an unshifted one.
      const precision = kind === 'amount' ? decimals : 0;
      return {
        ruleset,
        amount: precision === null ? null : formatAtomicAmount(source, precision),
        word: null,
      };
    });
    const first = readings[0];
    const diverges = readings.some(
      (reading) =>
        reading.word !== first.word ||
        (reading.amount?.exact ?? null) !== (first.amount?.exact ?? null)
    );
    return { key, label: humanizeFieldName(key), kind, readings, diverges };
  });

  const divergence = isRecord(item.divergence) ? item.divergence : {};

  return {
    tick: text(item.tick) ?? '',
    decimals,
    decimalsExact,
    lens: lens && names.includes(lens) ? lens : null,
    rulesets: ordered,
    figures,
    divergingFields: figures.filter((figure) => figure.diverges).map((figure) => figure.key),
    statedDivergingFields: Array.isArray(divergence.fields)
      ? divergence.fields.filter((field): field is string => typeof field === 'string')
      : [],
    absentFrom: Array.isArray(divergence.absent_from)
      ? divergence.absent_from.filter((name): name is string => typeof name === 'string')
      : [],
    unevaluated: Array.isArray(divergence.unevaluated)
      ? divergence.unevaluated.filter(isRecord).map((rule) => ({
          id: text(rule.id) ?? '',
          summary: text(rule.summary) ?? '',
          reason: text(rule.reason) ?? '',
        }))
      : [],
    unreadFields: unread,
  };
}

// ---------------------------------------------------------------------------
// The list page
// ---------------------------------------------------------------------------

/**
 * The figure columns the list table shows, in this order, when a row carries
 * them. Chosen for what a visitor scanning 159 tokens is deciding between:
 * whether a token is still mintable, how much of it exists, and how widely it
 * is held. Every other figure is on the token's own page, and the columns the
 * table is holding back are named beside it rather than dropped.
 */
const LIST_FIGURE_COLUMNS = ['status', 'minted', 'max_supply', 'holders'];

export interface RulesetListColumn {
  readonly key: string;
  readonly label: string;
  readonly kind: FigureKind;
}

export interface RulesetAssetListRow {
  readonly tick: string;
  /** The full reading, so the row's cells never re-derive what it holds. */
  readonly reading: RulesetAssetReading;
  /** One cell per column. Null where this token has no such figure. */
  readonly cells: readonly { key: string; figure: RulesetFigure | null }[];
  /** True when any figure of this token differs between the readings. */
  readonly diverges: boolean;
}

export interface RulesetAssetListReading {
  readonly lens: string | null;
  /** Every ruleset seen across the rows, lens first. */
  readonly rulesets: readonly string[];
  readonly columns: readonly RulesetListColumn[];
  readonly rows: readonly RulesetAssetListRow[];
  readonly shownCount: number;
  /** The authority's own total, exactly as sent. Null when it sent none. */
  readonly totalExact: string | null;
  /**
   * Figure fields present in the rows that are not columns here. Named, so a
   * table that shows four of nine figures says so instead of reading as the
   * whole ledger.
   */
  readonly hiddenFigureFields: readonly string[];
  /** Items in the response this reading could not read as ruleset assets. */
  readonly unreadRowCount: number;
}

/**
 * A page of assets whose items each carry their own `rulesets` ledger.
 *
 * Returns null for a payload without such items, so everything else keeps the
 * reading it already had. The list shows each figure under the lens reading;
 * a cell whose readings disagree shows every reading, because the table
 * quietly picking one is the same invented consensus the detail reading
 * refuses to print.
 */
export function readRulesetAssetList(payload: unknown): RulesetAssetListReading | null {
  if (!isRecord(payload) || !Array.isArray(payload.items) || !payload.items.length) {
    return null;
  }
  const lens = text(payload.lens);
  const rows: RulesetAssetListRow[] = [];
  let unreadRowCount = 0;
  for (const item of payload.items) {
    const reading = readRulesetAsset(item, lens);
    if (!reading) {
      unreadRowCount += 1;
      continue;
    }
    rows.push({
      tick: reading.tick,
      reading,
      cells: [],
      diverges: reading.divergingFields.length > 0,
    });
  }
  if (!rows.length) {
    return null;
  }

  const present = new Set<string>();
  for (const row of rows) {
    for (const figure of row.reading.figures) {
      present.add(figure.key);
    }
  }
  const columns: RulesetListColumn[] = LIST_FIGURE_COLUMNS.filter((key) =>
    present.has(key)
  ).map((key) => ({
    key,
    label: humanizeFieldName(key),
    kind: FIGURE_KIND[key],
  }));
  const hiddenFigureFields = [...present].filter(
    (key) => !LIST_FIGURE_COLUMNS.includes(key)
  );

  const rulesets: string[] = [];
  for (const row of rows) {
    for (const name of row.reading.rulesets) {
      if (!rulesets.includes(name)) {
        rulesets.push(name);
      }
    }
  }

  return {
    lens,
    rulesets,
    columns,
    rows: rows.map((row) => ({
      ...row,
      cells: columns.map((column) => ({
        key: column.key,
        figure: row.reading.figures.find((figure) => figure.key === column.key) ?? null,
      })),
    })),
    shownCount: rows.length,
    totalExact: text(payload.total),
    hiddenFigureFields,
    unreadRowCount,
  };
}
