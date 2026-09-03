import { describe, expect, it } from 'vitest';
import { buildCalendarGrid } from '@app/universe/portfolio/portfolio-calendar';
import { PortfolioCalendarDay } from '@app/universe/portfolio/portfolio.types';

function day(
  date: string,
  realized: string,
  realizationCount = 1,
): PortfolioCalendarDay {
  return { date, realized, realizationCount };
}

describe('buildCalendarGrid', () => {
  it('produces an empty grid from an empty series rather than an arbitrary month', () => {
    const grid = buildCalendarGrid([]);
    expect(grid.weeks).toEqual([]);
    expect(grid.firstDate).toBeNull();
    expect(grid.activeDayCount).toBe(0);
  });

  it('pads to whole Monday-to-Sunday weeks', () => {
    // 2026-09-02 is a Wednesday, so its week starts Monday 2026-08-31.
    const grid = buildCalendarGrid([day('2026-09-02', '10')]);
    expect(grid.weeks).toHaveLength(1);
    expect(grid.weeks[0].cells).toHaveLength(7);
    expect(grid.weekdays[0]).toBe('Mon');
    // Wednesday is the third column.
    expect(grid.weeks[0].cells[2].date).toBe('2026-09-02');
    // Days outside the active range are padding with no date.
    expect(grid.weeks[0].cells[0].date).toBeNull();
    expect(grid.weeks[0].cells[6].date).toBeNull();
  });

  it('spans every day between the first and last, including quiet ones', () => {
    const grid = buildCalendarGrid([
      day('2026-09-01', '10'),
      day('2026-09-10', '20'),
    ]);
    const dated = grid.weeks
      .flatMap((week) => week.cells)
      .filter((cell) => cell.date !== null);
    // Inclusive span of ten days.
    expect(dated).toHaveLength(10);
    // The quiet days carry no value and no band.
    const quiet = dated.filter((cell) => cell.realized === null);
    expect(quiet).toHaveLength(8);
    expect(quiet.every((cell) => cell.band === null)).toBe(true);
  });

  it('crosses a month boundary without losing a day', () => {
    const grid = buildCalendarGrid([
      day('2026-08-30', '5'),
      day('2026-09-02', '5'),
    ]);
    const dates = grid.weeks
      .flatMap((week) => week.cells)
      .filter((cell) => cell.date !== null)
      .map((cell) => cell.date);
    expect(dates).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('handles a leap day', () => {
    const grid = buildCalendarGrid([
      day('2028-02-28', '1'),
      day('2028-03-01', '1'),
    ]);
    const dates = grid.weeks
      .flatMap((week) => week.cells)
      .filter((cell) => cell.date !== null)
      .map((cell) => cell.date);
    expect(dates).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('bands gains positive and losses negative', () => {
    const grid = buildCalendarGrid([
      day('2026-09-01', '100'),
      day('2026-09-02', '-100'),
      day('2026-09-03', '0'),
    ]);
    const byDate = new Map(
      grid.weeks
        .flatMap((week) => week.cells)
        .filter((cell) => cell.realized !== null)
        .map((cell) => [cell.date, cell.band]),
    );
    expect(byDate.get('2026-09-01')).toBeGreaterThan(0);
    expect(byDate.get('2026-09-02')).toBeLessThan(0);
    expect(byDate.get('2026-09-03')).toBe(0);
  });

  it('ranks bands within each sign so one huge day cannot flatten the rest', () => {
    const grid = buildCalendarGrid([
      day('2026-09-01', '1'),
      day('2026-09-02', '100'),
      day('2026-09-03', '1000000'),
    ]);
    const byDate = new Map(
      grid.weeks
        .flatMap((week) => week.cells)
        .filter((cell) => cell.realized !== null)
        .map((cell) => [cell.date, cell.band]),
    );
    // Three gains spread across the three gain bands rather than
    // collapsing into one because of the outlier.
    expect(byDate.get('2026-09-01')).toBe(1);
    expect(byDate.get('2026-09-02')).toBe(2);
    expect(byDate.get('2026-09-03')).toBe(3);
  });

  it('compares magnitudes exactly, past the safe integer range', () => {
    const grid = buildCalendarGrid([
      day('2026-09-01', '9007199254740993'),
      day('2026-09-02', '9007199254740994'),
      day('2026-09-03', '9007199254740995'),
    ]);
    const byDate = new Map(
      grid.weeks
        .flatMap((week) => week.cells)
        .filter((cell) => cell.realized !== null)
        .map((cell) => [cell.date, cell.band]),
    );
    // A float comparison would see these three as equal.
    expect(byDate.get('2026-09-01')).toBe(1);
    expect(byDate.get('2026-09-02')).toBe(2);
    expect(byDate.get('2026-09-03')).toBe(3);
  });

  it('ignores days whose date it cannot read', () => {
    const grid = buildCalendarGrid([
      day('2026-09-01', '10'),
      day('not-a-date', '10'),
    ]);
    expect(grid.activeDayCount).toBe(1);
  });

  it('keeps the exact realized string for display', () => {
    const grid = buildCalendarGrid([day('2026-09-01', '1234.56789012')]);
    const cell = grid.weeks
      .flatMap((week) => week.cells)
      .find((candidate) => candidate.date === '2026-09-01');
    expect(cell?.realized).toBe('1234.56789012');
    expect(cell?.realizationCount).toBe(1);
  });
});
