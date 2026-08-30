/**
 * Value presentation for the chain chart pages.
 *
 * Pure functions. Axis labels work from the plotted number, because that is
 * all an axis has; tooltips and the table work from the decimal string the
 * backend sent, so what a reader copies is what the authority said.
 */

import {
  formatDifficulty,
  formatNetworkRate,
  formatSeconds,
} from '@app/universe/chain-dashboard/chain-dashboard-format';
import {
  formatAtomicAmount,
  formatExactInteger,
} from '@app/universe/multichain-explorer/multichain-view';
import { ChartValueKind } from '@app/universe/chain-graphs/chain-chart-config';

export interface ChartValueContext {
  /** Decimal places between the chain's atomic unit and its ticker unit. */
  readonly precision: number;
  readonly ticker: string;
  /** The hashrate line's own unit field, which names the rate unit. */
  readonly rateUnit: string | null;
}

const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const INTEGER = /^-?(0|[1-9][0-9]*)$/;

/** Zcash measures capacity in Equihash solutions, everything else in hashes. */
function rateWireUnit(unit: string | null): 'hashes-per-second' | 'solutions-per-second' {
  return unit !== null && /sol/i.test(unit) ? 'solutions-per-second' : 'hashes-per-second';
}

function rateSuffix(unit: string | null): string {
  return rateWireUnit(unit) === 'solutions-per-second' ? 'Sol/s' : 'H/s';
}

const SI_STEPS: [number, string][] = [
  [1e18, 'E'],
  [1e15, 'P'],
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
];

/** A number shrunk to axis width: 1234000 reads "1.23M". */
function compact(value: number): string {
  const negative = value < 0;
  const magnitude = Math.abs(value);
  for (const [step, prefix] of SI_STEPS) {
    if (magnitude >= step) {
      const scaled = (magnitude / step).toPrecision(3).replace(/\.?0+$/, '');
      return (negative ? '-' : '') + scaled + prefix;
    }
  }
  if (magnitude === 0) {
    return '0';
  }
  const small =
    magnitude >= 1
      ? String(Math.round(magnitude * 100) / 100)
      : magnitude.toPrecision(2).replace(/\.?0+$/, '');
  return (negative ? '-' : '') + small;
}

const BYTE_STEPS: [number, string][] = [
  [1e12, 'TB'],
  [1e9, 'GB'],
  [1e6, 'MB'],
  [1e3, 'kB'],
];

function humanBytes(value: number): string {
  const magnitude = Math.abs(value);
  for (const [step, unit] of BYTE_STEPS) {
    if (magnitude >= step) {
      return `${(value / step).toPrecision(3).replace(/\.?0+$/, '')} ${unit}`;
    }
  }
  return `${Math.round(value)} B`;
}

/**
 * The number a point is plotted at. Atomic amounts are shifted to the ticker
 * unit so the axis reads in coins, and shares are shifted to percent so a
 * stacked dominance chart tops out at 100. A malformed value plots as a gap,
 * never as zero.
 */
export function plotValue(
  raw: string | null,
  kind: ChartValueKind,
  precision: number
): number | null {
  if (raw === null || !DECIMAL.test(raw)) {
    return null;
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (kind === 'atomic-amount') {
    return numeric / 10 ** precision;
  }
  if (kind === 'share') {
    return numeric * 100;
  }
  return numeric;
}

/** An axis tick, written for the value kind the axis carries. */
export function formatAxisValue(
  value: number,
  kind: ChartValueKind,
  ctx: ChartValueContext
): string {
  switch (kind) {
    case 'bytes':
      return humanBytes(value);
    case 'atomic-amount':
      return `${compact(value)} ${ctx.ticker}`;
    case 'seconds':
      return value < 90 ? `${Math.round(value)} s` : `${Math.round(value / 60)} min`;
    case 'rate':
      return `${compact(value)}${rateSuffix(ctx.rateUnit)}`;
    case 'share':
      return `${Math.round(value)}%`;
    case 'difficulty':
    case 'fee-rate':
    case 'count':
    default:
      return compact(value);
  }
}

/**
 * A point as the tooltip and the table print it, from the exact string the
 * backend sent. An absent value renders as an empty string so the caller can
 * decide how to say "not recorded".
 */
export function formatPointDisplay(
  raw: string | null,
  kind: ChartValueKind,
  ctx: ChartValueContext,
  lineUnit: string | null
): string {
  if (raw === null || raw === '') {
    return '';
  }
  switch (kind) {
    case 'atomic-amount': {
      const amount = formatAtomicAmount(raw, ctx.precision);
      return amount ? `${amount.display} ${ctx.ticker}` : raw;
    }
    case 'count': {
      if (INTEGER.test(raw)) {
        return formatExactInteger(raw)?.display ?? raw;
      }
      return DECIMAL.test(raw) ? String(Math.round(Number(raw) * 100) / 100) : raw;
    }
    case 'bytes': {
      if (!DECIMAL.test(raw)) {
        return raw;
      }
      return humanBytes(Number(raw));
    }
    case 'seconds':
      return formatSeconds(raw)?.display ?? raw;
    case 'difficulty':
      return formatDifficulty(raw)?.display ?? raw;
    case 'rate':
      return formatNetworkRate(raw, rateWireUnit(lineUnit ?? ctx.rateUnit))?.display ?? raw;
    case 'share': {
      if (!DECIMAL.test(raw)) {
        return raw;
      }
      const percent = Number(raw) * 100;
      return `${(Math.round(percent * 100) / 100).toString()}%`;
    }
    case 'fee-rate':
    default:
      return lineUnit ? `${raw} ${lineUnit}` : raw;
  }
}
