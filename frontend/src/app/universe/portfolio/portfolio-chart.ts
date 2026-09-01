/**
 * Pure chart geometry for the portfolio history series.
 *
 * The chart is an inline SVG polyline built here rather than in a
 * template, so the arithmetic that decides what a reader sees is testable
 * on its own. Values arrive as exact decimal strings; they are converted
 * to numbers only for pixel positions, never for anything a reader would
 * copy as a balance, and every point keeps its exact original string for
 * the accompanying data table.
 */

import { PortfolioHistoryPoint } from '@app/universe/portfolio/portfolio.types';

export interface ChartPoint {
  /** Pixel position inside the viewBox. */
  readonly x: number;
  readonly y: number;
  /** The exact values behind the position, for the table and tooltips. */
  readonly balanceAtomic: string;
  readonly value: string | null;
  readonly blockHeightAtomic: string;
  readonly blockTimeAtomic: string | null;
  readonly txid: string;
}

export interface ChartGeometry {
  readonly points: readonly ChartPoint[];
  /** The polyline `points` attribute, empty when nothing can be drawn. */
  readonly polyline: string;
  /** Closed area path under the line, for the fill. */
  readonly areaPath: string;
  readonly width: number;
  readonly height: number;
  /** Exact decimal strings of the extremes, for the axis labels. */
  readonly maxBalanceAtomic: string;
  readonly minBalanceAtomic: string;
  /** True when every point shares one balance, so the line is flat. */
  readonly flat: boolean;
}

export const CHART_WIDTH = 720;
export const CHART_HEIGHT = 180;
const PADDING_Y = 8;

/**
 * Builds the geometry for a balance series. Points are laid out evenly on
 * the x axis in series order; the y axis spans the observed balance range.
 * A series of fewer than two points draws nothing: a single point is a
 * fact, not a trend, and a one-point line would imply a shape that was
 * never observed.
 */
export function buildChartGeometry(
  series: readonly PortfolioHistoryPoint[],
): ChartGeometry {
  const usable = series.filter((point) => /^(0|[1-9][0-9]*)$/.test(point.balanceAtomic));
  if (usable.length < 2) {
    return {
      points: [],
      polyline: '',
      areaPath: '',
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      maxBalanceAtomic: usable[0]?.balanceAtomic ?? '0',
      minBalanceAtomic: usable[0]?.balanceAtomic ?? '0',
      flat: true,
    };
  }

  let max = BigInt(usable[0].balanceAtomic);
  let min = max;
  for (const point of usable) {
    const balance = BigInt(point.balanceAtomic);
    if (balance > max) { max = balance; }
    if (balance < min) { min = balance; }
  }
  const flat = max === min;
  const span = flat ? 1n : max - min;
  const plotHeight = CHART_HEIGHT - PADDING_Y * 2;

  const points: ChartPoint[] = usable.map((point, index) => {
    const x = (index / (usable.length - 1)) * CHART_WIDTH;
    // Ratio in [0,1] from the BigInt span, scaled through an integer
    // numerator so a balance beyond the safe integer range still lands
    // in the right place.
    const offset = flat
      ? 0.5
      : Number(((BigInt(point.balanceAtomic) - min) * 10000n) / span) / 10000;
    const y = CHART_HEIGHT - PADDING_Y - offset * plotHeight;
    return {
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      balanceAtomic: point.balanceAtomic,
      value: point.value,
      blockHeightAtomic: point.blockHeightAtomic,
      blockTimeAtomic: point.blockTimeAtomic,
      txid: point.txid,
    };
  });

  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');
  const areaPath =
    `M ${points[0].x} ${CHART_HEIGHT} `
    + points.map((point) => `L ${point.x} ${point.y}`).join(' ')
    + ` L ${points[points.length - 1].x} ${CHART_HEIGHT} Z`;

  return {
    points,
    polyline,
    areaPath,
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    maxBalanceAtomic: max.toString(),
    minBalanceAtomic: min.toString(),
    flat,
  };
}
