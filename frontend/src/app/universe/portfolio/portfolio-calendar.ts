/**
 * Pure layout for the profit and loss calendar.
 *
 * The calendar is a grid of weeks, so it needs the empty days at both
 * ends that make the columns line up by weekday. Building that here
 * rather than in a template keeps the date arithmetic testable, and the
 * arithmetic is the part that goes wrong: a month boundary, a leap day,
 * or a week that starts on the wrong column all produce a grid that
 * looks plausible and is wrong.
 *
 * Realized values stay exact decimal strings throughout; only the
 * comparison that picks a colour band reads them numerically, and it
 * does so by sign and by rank among the days present, never by an
 * absolute threshold that would mean different things for different
 * portfolios.
 */

import { PortfolioCalendarDay } from '@app/universe/portfolio/portfolio.types';

export interface CalendarCell {
  /** YYYY-MM-DD, or null for a padding cell outside the range. */
  readonly date: string | null;
  readonly realized: string | null;
  readonly realizationCount: number;
  /**
   * Band from -3 to 3: negative for losses, positive for gains, 0 for a
   * day with activity that netted exactly zero, null for no activity.
   * Bands are assigned by rank within this calendar, so the scale always
   * uses its full range regardless of the size of the portfolio.
   */
  readonly band: number | null;
}

export interface CalendarWeek {
  readonly cells: readonly CalendarCell[];
}

export interface CalendarGrid {
  readonly weeks: readonly CalendarWeek[];
  /** Weekday labels in the order the columns appear, starting Monday. */
  readonly weekdays: readonly string[];
  readonly firstDate: string | null;
  readonly lastDate: string | null;
  readonly activeDayCount: number;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Days between two YYYY-MM-DD dates, using UTC to avoid zone drift. */
function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function dateFromDayNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** Monday-based weekday index: Monday is 0, Sunday is 6. */
function weekdayIndex(date: string): number {
  const jsDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (jsDay + 6) % 7;
}

/** Sign of an exact decimal string: -1, 0, or 1. Null when malformed. */
function decimalSign(value: string): -1 | 0 | 1 | null {
  if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) { return null; }
  if (value.startsWith('-')) { return -1; }
  return /^0(\.0+)?$/.test(value) ? 0 : 1;
}

/** Compares two exact decimal magnitudes without floating point. */
function compareMagnitude(a: string, b: string): number {
  const strip = (value: string): [string, string] => {
    const magnitude = value.startsWith('-') ? value.slice(1) : value;
    const [whole, fraction = ''] = magnitude.split('.');
    return [whole.replace(/^0+(?=\d)/, ''), fraction];
  };
  const [wholeA, fractionA] = strip(a);
  const [wholeB, fractionB] = strip(b);
  if (wholeA.length !== wholeB.length) {
    return wholeA.length < wholeB.length ? -1 : 1;
  }
  if (wholeA !== wholeB) { return wholeA < wholeB ? -1 : 1; }
  const width = Math.max(fractionA.length, fractionB.length);
  const paddedA = fractionA.padEnd(width, '0');
  const paddedB = fractionB.padEnd(width, '0');
  if (paddedA === paddedB) { return 0; }
  return paddedA < paddedB ? -1 : 1;
}

/**
 * Assigns bands by rank so the scale uses its full range whatever the
 * size of the portfolio. Gains take bands 1 to 3 and losses -1 to -3,
 * each ranked among its own sign, so one enormous day cannot flatten
 * every other day into the same colour.
 */
function assignBands(
  days: readonly PortfolioCalendarDay[],
): Map<string, number> {
  const bands = new Map<string, number>();
  const gains: PortfolioCalendarDay[] = [];
  const losses: PortfolioCalendarDay[] = [];
  for (const day of days) {
    const sign = decimalSign(day.realized);
    if (sign === null) { continue; }
    if (sign > 0) { gains.push(day); }
    else if (sign < 0) { losses.push(day); }
    else { bands.set(day.date, 0); }
  }
  const rank = (
    group: PortfolioCalendarDay[],
    direction: 1 | -1,
  ): void => {
    const sorted = [...group].sort((a, b) =>
      compareMagnitude(a.realized, b.realized),
    );
    for (let index = 0; index < sorted.length; index += 1) {
      // Thirds of the ranked group, so every band is used when there are
      // enough days and small groups still spread across the scale.
      const third = Math.floor((index * 3) / Math.max(sorted.length, 1));
      bands.set(sorted[index].date, direction * Math.min(third + 1, 3));
    }
  };
  rank(gains, 1);
  rank(losses, -1);
  return bands;
}

/**
 * Builds the week grid spanning every day from the first to the last day
 * with activity, padded to whole weeks. An empty series produces an
 * empty grid rather than an arbitrary month.
 */
export function buildCalendarGrid(
  days: readonly PortfolioCalendarDay[],
): CalendarGrid {
  const usable = days.filter((day) => DATE.test(day.date));
  if (usable.length === 0) {
    return {
      weeks: [],
      weekdays: WEEKDAYS,
      firstDate: null,
      lastDate: null,
      activeDayCount: 0,
    };
  }
  const sorted = [...usable].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((day) => [day.date, day]));
  const bands = assignBands(sorted);

  const firstDate = sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;
  // Pad to whole Monday-to-Sunday weeks so the columns line up.
  const start = dayNumber(firstDate) - weekdayIndex(firstDate);
  const end = dayNumber(lastDate) + (6 - weekdayIndex(lastDate));

  const weeks: CalendarWeek[] = [];
  let cells: CalendarCell[] = [];
  for (let day = start; day <= end; day += 1) {
    const date = dateFromDayNumber(day);
    const entry = byDate.get(date);
    const inRange = date >= firstDate && date <= lastDate;
    cells.push({
      date: inRange ? date : null,
      realized: entry ? entry.realized : null,
      realizationCount: entry ? entry.realizationCount : 0,
      band: entry ? (bands.get(date) ?? 0) : null,
    });
    if (cells.length === 7) {
      weeks.push({ cells });
      cells = [];
    }
  }
  if (cells.length > 0) { weeks.push({ cells }); }

  return {
    weeks,
    weekdays: WEEKDAYS,
    firstDate,
    lastDate,
    activeDayCount: sorted.length,
  };
}
