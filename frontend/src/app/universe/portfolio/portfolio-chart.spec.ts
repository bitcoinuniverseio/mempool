import { describe, expect, it } from 'vitest';
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  buildChartGeometry,
} from '@app/universe/portfolio/portfolio-chart';
import { PortfolioHistoryPoint } from '@app/universe/portfolio/portfolio.types';

function point(
  balanceAtomic: string,
  overrides: Partial<PortfolioHistoryPoint> = {},
): PortfolioHistoryPoint {
  return {
    txid: balanceAtomic.padStart(64, '0'),
    blockHeightAtomic: '900000',
    blockTimeAtomic: '1756209600',
    balanceAtomic,
    deltaAtomic: '0',
    value: null,
    ...overrides,
  };
}

describe('buildChartGeometry', () => {
  it('draws nothing from fewer than two points', () => {
    expect(buildChartGeometry([]).polyline).toBe('');
    expect(buildChartGeometry([point('100')]).polyline).toBe('');
    expect(buildChartGeometry([point('100')]).points).toEqual([]);
  });

  it('spans the full width and puts the extremes at the edges', () => {
    const geometry = buildChartGeometry([
      point('0'),
      point('50'),
      point('100'),
    ]);
    expect(geometry.points).toHaveLength(3);
    expect(geometry.points[0].x).toBe(0);
    expect(geometry.points[2].x).toBe(CHART_WIDTH);
    // The lowest balance sits lower on the screen than the highest, and
    // both stay inside the box.
    expect(geometry.points[0].y).toBeGreaterThan(geometry.points[2].y);
    expect(geometry.points[2].y).toBeGreaterThanOrEqual(0);
    expect(geometry.points[0].y).toBeLessThanOrEqual(CHART_HEIGHT);
    expect(geometry.maxBalanceAtomic).toBe('100');
    expect(geometry.minBalanceAtomic).toBe('0');
    expect(geometry.flat).toBe(false);
  });

  it('centers a flat series rather than dividing by a zero span', () => {
    const geometry = buildChartGeometry([point('42'), point('42')]);
    expect(geometry.flat).toBe(true);
    expect(geometry.points[0].y).toBe(geometry.points[1].y);
    expect(Number.isFinite(geometry.points[0].y)).toBe(true);
  });

  it('places balances beyond the safe integer range correctly', () => {
    const geometry = buildChartGeometry([
      point('9007199254740993'),
      point('9007199254740994'),
      point('9007199254740995'),
    ]);
    // The middle point sits between the other two, which a float-based
    // ratio would collapse at this magnitude.
    expect(geometry.points[1].y).toBeLessThan(geometry.points[0].y);
    expect(geometry.points[1].y).toBeGreaterThan(geometry.points[2].y);
  });

  it('keeps every exact value alongside its pixel position', () => {
    const geometry = buildChartGeometry([
      point('100', { value: '10.5' }),
      point('200', { value: null }),
    ]);
    expect(geometry.points[0].balanceAtomic).toBe('100');
    expect(geometry.points[0].value).toBe('10.5');
    expect(geometry.points[1].value).toBeNull();
  });

  it('ignores malformed balances instead of drawing a wrong shape', () => {
    const geometry = buildChartGeometry([
      point('100'),
      point('not-a-number'),
      point('300'),
    ]);
    expect(geometry.points).toHaveLength(2);
    expect(geometry.maxBalanceAtomic).toBe('300');
  });

  it('closes the area path back to the baseline', () => {
    const geometry = buildChartGeometry([point('0'), point('100')]);
    expect(geometry.areaPath.startsWith('M 0 ' + CHART_HEIGHT)).toBe(true);
    expect(geometry.areaPath.endsWith('Z')).toBe(true);
  });
});
