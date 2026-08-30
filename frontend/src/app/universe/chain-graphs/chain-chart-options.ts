/**
 * ECharts option assembly for the chain chart cards.
 *
 * Every colour comes from the shared chart chrome, which resolves the --u-*
 * custom properties once per theme. Nothing here names a colour literal, so
 * the charts move with the theme like the rest of the product.
 */

import type { EChartsCoreOption } from 'echarts/core';
import {
  chartChrome,
  chartTooltipStyle,
  seriesColor,
  seriesLineType,
} from '@app/shared/chart-theme';
import {
  ChartCardKind,
  ChartValueKind,
} from '@app/universe/chain-graphs/chain-chart-config';
import {
  ChartValueContext,
  formatAxisValue,
  formatPointDisplay,
} from '@app/universe/chain-graphs/chain-chart-format';

/** One line of a card, ready to draw: plotted numbers plus their sources. */
export interface PlottedChartLine {
  readonly key: string;
  readonly label: string;
  /** The unit the backend stated for this line, kept for the tooltip. */
  readonly unit: string | null;
  /** [epoch milliseconds, plotted value or gap]. */
  readonly points: readonly [number, number | null][];
  /** The exact decimal string behind each plotted point. */
  readonly raw: ReadonlyMap<number, string | null>;
  readonly valueKind: ChartValueKind;
  readonly yAxisIndex: 0 | 1;
  /** A leftover bucket like unknown or other, drawn without a loud colour. */
  readonly muted: boolean;
  /** A stated target rather than an observation, drawn dashed. */
  readonly reference: boolean;
}

export interface CardChartInput {
  readonly kind: ChartCardKind;
  readonly lines: readonly PlottedChartLine[];
  readonly primaryKind: ChartValueKind;
  readonly secondaryKind: ChartValueKind | null;
  readonly ctx: ChartValueContext;
  /** False when the reader asked for reduced motion. */
  readonly animate: boolean;
  /** Renders an epoch-milliseconds tick for the tooltip heading. */
  readonly timestampFor: (ms: number) => string;
}

function yAxis(
  kind: ChartValueKind,
  ctx: ChartValueContext,
  position: 'left' | 'right',
  chrome: ReturnType<typeof chartChrome>
): Record<string, unknown> {
  return {
    type: 'value',
    position,
    max: kind === 'share' ? 100 : undefined,
    axisLabel: {
      color: chrome.label,
      formatter: (value: number) => formatAxisValue(value, kind, ctx),
    },
    axisLine: { lineStyle: { color: chrome.axis } },
    splitLine:
      position === 'right'
        ? { show: false }
        : { lineStyle: { type: 'dotted', color: chrome.grid, opacity: 0.6 } },
  };
}

export function buildCardOptions(input: CardChartInput): EChartsCoreOption {
  const chrome = chartChrome();
  const stacked = input.kind === 'stacked-area';
  const filled = stacked || input.kind === 'area';

  let colorIndex = 0;
  const series = input.lines.map((line) => {
    const special = line.muted || line.reference;
    const color = special ? chrome.axis : seriesColor(colorIndex);
    const lineType = line.reference
      ? 'dashed'
      : input.kind === 'multi-line'
        ? seriesLineType(colorIndex)
        : 'solid';
    if (!special) {
      colorIndex += 1;
    }
    return {
      name: line.label,
      type: 'line',
      yAxisIndex: line.yAxisIndex,
      data: line.points as [number, number | null][],
      showSymbol: false,
      smooth: false,
      stack: stacked && !line.reference ? 'total' : undefined,
      color,
      lineStyle: {
        width: line.reference ? 1 : 2,
        type: lineType,
        opacity: line.muted ? 0.8 : 1,
      },
      areaStyle:
        filled && !line.reference
          ? { opacity: stacked ? 0.4 : 0.18 }
          : undefined,
      emphasis: stacked ? { focus: 'series' } : undefined,
    };
  });

  const axes: Record<string, unknown>[] = [
    yAxis(input.primaryKind, input.ctx, 'left', chrome),
  ];
  if (input.secondaryKind) {
    axes.push(yAxis(input.secondaryKind, input.ctx, 'right', chrome));
  }

  const lines = input.lines;
  const ctx = input.ctx;
  const timestampFor = input.timestampFor;

  return {
    animation: input.animate,
    grid: { top: 24, bottom: 32, left: 12, right: 12, containLabel: true },
    legend:
      lines.length > 1
        ? {
            icon: 'roundRect',
            textStyle: { color: chrome.label },
            inactiveColor: chrome.label,
          }
        : undefined,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      ...chartTooltipStyle(),
      formatter: (params: unknown): string => {
        const ticks = Array.isArray(params) ? params : [params];
        if (!ticks.length) {
          return '';
        }
        const first = ticks[0] as { data: [number, number | null] };
        const ms = first.data?.[0];
        if (typeof ms !== 'number') {
          return '';
        }
        let out = `<b>${timestampFor(ms)}</b>`;
        for (const tick of ticks as {
          seriesIndex: number;
          marker: string;
          data: [number, number | null];
        }[]) {
          const line = lines[tick.seriesIndex];
          if (!line) {
            continue;
          }
          const raw = line.raw.get(ms) ?? null;
          const display = formatPointDisplay(raw, line.valueKind, ctx, line.unit);
          if (display === '') {
            continue;
          }
          out += `<br>${tick.marker} ${line.label}: ${display}`;
        }
        return out;
      },
    },
    xAxis: {
      type: 'time',
      axisLabel: { color: chrome.label, hideOverlap: true },
      axisLine: { lineStyle: { color: chrome.axis } },
    },
    yAxis: axes,
    series,
  };
}

/** The donut of pool shares on the pools ranking page. */
export interface PoolSlice {
  readonly name: string;
  readonly value: number;
  readonly muted: boolean;
}

export function buildPoolDonutOptions(
  slices: readonly PoolSlice[],
  animate: boolean
): EChartsCoreOption {
  const chrome = chartChrome();
  let colorIndex = 0;
  return {
    animation: animate,
    tooltip: {
      trigger: 'item',
      ...chartTooltipStyle(),
      valueFormatter: (value: unknown): string =>
        typeof value === 'number' ? `${(Math.round(value * 10) / 10).toString()}%` : '',
    },
    series: [
      {
        type: 'pie',
        radius: ['45%', '75%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: chrome.markBorder, borderWidth: 1 },
        label: { color: chrome.label, formatter: '{b}' },
        labelLine: { lineStyle: { color: chrome.axis } },
        data: slices.map((slice) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: {
            color: slice.muted ? chrome.axis : seriesColor(colorIndex++),
          },
        })),
      },
    ],
  };
}
