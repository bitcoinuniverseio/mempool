/**
 * Display helpers for the dashboard and mining pages. Each keeps the exact
 * source string beside the rendering, so a rounded figure is always
 * checkable against what the API said.
 */

import { ExactNumber } from '@app/universe/multichain-explorer/multichain-view';

const SI_STEPS: [number, string][] = [
  [1e18, 'E'],
  [1e15, 'P'],
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
];

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** "1621340000000000" with unit "hashes-per-second" reads "1.62 PH/s". */
export function formatNetworkRate(
  value: string | null,
  unit: 'hashes-per-second' | 'solutions-per-second'
): ExactNumber | null {
  if (value === null || !DECIMAL.test(value)) {
    return null;
  }
  const suffix = unit === 'hashes-per-second' ? 'H/s' : 'Sol/s';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  for (const [step, prefix] of SI_STEPS) {
    if (numeric >= step) {
      return {
        display: `${(numeric / step).toFixed(2)} ${prefix}${suffix}`,
        exact: value,
      };
    }
  }
  return { display: `${numeric.toFixed(2)} ${suffix}`, exact: value };
}

/** A difficulty stays unitless; it only shrinks to a readable magnitude. */
export function formatDifficulty(value: string | null): ExactNumber | null {
  if (value === null || !DECIMAL.test(value)) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  for (const [step, prefix] of SI_STEPS) {
    if (numeric >= step) {
      return {
        display: `${(numeric / step).toFixed(2)} ${prefix}`,
        exact: value,
      };
    }
  }
  return { display: numeric.toFixed(numeric >= 100 ? 0 : 2), exact: value };
}

/** "61.4" seconds reads "1 min 1 s"; short spans stay in seconds. */
export function formatSeconds(value: string | null): ExactNumber | null {
  if (value === null || !DECIMAL.test(value)) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  if (numeric < 90) {
    return { display: `${Math.round(numeric)} s`, exact: value };
  }
  const minutes = Math.floor(numeric / 60);
  const seconds = Math.round(numeric % 60);
  return {
    display: seconds ? `${minutes} min ${seconds} s` : `${minutes} min`,
    exact: value,
  };
}

/**
 * A koinu-per-kilobyte figure shifted to the ticker unit per kilobyte:
 * "2010471.204" koinu/kB reads "0.0201 DOGE/kB". The page states the unit.
 */
export function formatFeePerKb(
  value: string | null,
  precision: number
): ExactNumber | null {
  if (value === null || !DECIMAL.test(value)) {
    return null;
  }
  const numeric = Number(value) / 10 ** precision;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const display =
    numeric >= 1
      ? numeric.toFixed(2)
      : numeric.toPrecision(3).replace(/\.?0+$/, '');
  return { display, exact: value };
}
