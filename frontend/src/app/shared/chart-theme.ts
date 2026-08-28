/**
 * The colours the chart layer draws with.
 *
 * ECharts renders to a canvas, so it cannot read a CSS custom property the way
 * a stylesheet can. Every chart in this product therefore carried its own
 * literals, all of them chosen for a dark page: axis labels at #b1b1b1,
 * tooltip text at #fff, borders at #000. On the light theme those are a
 * white-on-white tooltip and an axis nobody can read.
 *
 * So the tokens are resolved here, once, and cached. `invalidate()` is called
 * when the theme changes, which is the only moment the answer can differ. No
 * chart reads a computed style while drawing, and nothing reads one per frame.
 */

/** Chart chrome: the parts of a chart that are structure rather than data. */
export interface ChartChrome {
  /** Axis lines and ticks. */
  axis: string;
  /** Axis and legend text. Held to the body contrast floor. */
  label: string;
  /** Text that carries a value rather than a name. */
  strongLabel: string;
  /** Grid lines behind the data. */
  grid: string;
  /** Tooltip panel. */
  tooltipBackground: string;
  tooltipBorder: string;
  tooltipText: string;
  /** The surface a chart is drawn on, for marks that need to sit on it. */
  surface: string;
  /** Outline drawn around a mark so it stays separable from its neighbour. */
  markBorder: string;
  /** Categorical series, in order. Verified separable under colour vision
   *  deficiency by `scripts/universe/check-palettes.mjs`. */
  series: string[];
  /** Sequential ramps for quantities. See `ChartRamps`. */
  ramps: ChartRamps;
}

/**
 * Ramps mean a quantity, not a category.
 *
 * `scale` is a five-stop sequential ramp that darkens on the light theme and
 * lightens on the dark one, so "more" always looks like more. `a`, `b`, and `c`
 * are two-stop ramps for the area fills that carry a single measure. Every stop
 * clears the graphical floor against both surfaces of its theme.
 */
export interface ChartRamps {
  scale: [string, string, string, string, string];
  a: [string, string];
  b: [string, string];
  c: [string, string];
}

/**
 * Symbols paired with the series colours, in the same order.
 *
 * Colour is never the only thing telling two lines apart: a reader who cannot
 * separate two hues still separates a circle from a triangle, and so does
 * anyone reading a printed or photocopied chart.
 */
export const CHART_SYMBOLS = ['circle', 'triangle', 'rect', 'diamond', 'roundRect', 'pin', 'arrow'];

/**
 * Dash patterns paired with the series colours, in the same order. `solid` for
 * the primary series so the common single-series chart is not decorated for
 * no reason.
 */
export const CHART_LINE_TYPES: ('solid' | 'dashed' | 'dotted')[] = [
  'solid', 'dashed', 'dotted', 'solid', 'dashed', 'dotted', 'solid',
];

const FALLBACK: ChartChrome = {
  axis: '#645a6e',
  label: '#645a6e',
  strongLabel: '#241a2b',
  grid: '#e8e0ee',
  tooltipBackground: '#ffffff',
  tooltipBorder: '#ded5e5',
  tooltipText: '#241a2b',
  surface: '#ffffff',
  markBorder: '#ffffff',
  series: ['#c40059', '#5b2fa6', '#8a5100', '#4393a3', '#3d0a2a', '#7f9b5a', '#a3006b'],
  ramps: {
    scale: ['#e0568f', '#c40059', '#a3006b', '#7a2f8f', '#5b2fa6'],
    a: ['#c40059', '#5b2fa6'],
    b: ['#8a5100', '#63172a'],
    c: ['#4393a3', '#1c4f5c'],
  },
};

let cached: ChartChrome | null = null;

function read(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

/** Drop the cache. Called when the theme changes, and only then. */
export function invalidateChartChrome(): void {
  cached = null;
}

/** The current theme's chart colours. Resolved once per theme. */
export function chartChrome(): ChartChrome {
  if (cached) return cached;
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return FALLBACK;
  }

  const styles = getComputedStyle(document.documentElement);
  cached = {
    axis: read(styles, '--u-chart-axis', FALLBACK.axis),
    label: read(styles, '--u-chart-axis', FALLBACK.label),
    strongLabel: read(styles, '--u-text-primary', FALLBACK.strongLabel),
    grid: read(styles, '--u-chart-grid', FALLBACK.grid),
    tooltipBackground: read(styles, '--u-surface-raised', FALLBACK.tooltipBackground),
    tooltipBorder: read(styles, '--u-border', FALLBACK.tooltipBorder),
    tooltipText: read(styles, '--u-text-primary', FALLBACK.tooltipText),
    surface: read(styles, '--u-surface-raised', FALLBACK.surface),
    markBorder: read(styles, '--u-surface-raised', FALLBACK.markBorder),
    series: FALLBACK.series.map((fallback, i) => read(styles, `--u-chart-${i + 1}`, fallback)),
    ramps: {
      scale: FALLBACK.ramps.scale.map((fallback, i) =>
        read(styles, `--u-ramp-scale-${i + 1}`, fallback)) as ChartRamps['scale'],
      a: ['from', 'to'].map((end, i) => read(styles, `--u-ramp-a-${end}`, FALLBACK.ramps.a[i])) as ChartRamps['a'],
      b: ['from', 'to'].map((end, i) => read(styles, `--u-ramp-b-${end}`, FALLBACK.ramps.b[i])) as ChartRamps['b'],
      c: ['from', 'to'].map((end, i) => read(styles, `--u-ramp-c-${end}`, FALLBACK.ramps.c[i])) as ChartRamps['c'],
    },
  };
  return cached;
}

/** The nth categorical series colour, wrapping for long categories. */
export function seriesColor(index: number): string {
  const { series } = chartChrome();
  return series[index % series.length];
}

/** The nth categorical symbol, so shape carries what colour alone should not. */
export function seriesSymbol(index: number): string {
  return CHART_SYMBOLS[index % CHART_SYMBOLS.length];
}

/** The nth categorical line style, for the same reason. */
export function seriesLineType(index: number): 'solid' | 'dashed' | 'dotted' {
  return CHART_LINE_TYPES[index % CHART_LINE_TYPES.length];
}

/** The tooltip panel every chart shares, so none of them invents its own. */
export function chartTooltipStyle(): Record<string, unknown> {
  const chrome = chartChrome();
  return {
    backgroundColor: chrome.tooltipBackground,
    borderColor: chrome.tooltipBorder,
    borderWidth: 1,
    textStyle: { color: chrome.tooltipText },
    extraCssText: 'box-shadow: var(--u-shadow-lg); border-radius: var(--u-radius-md);',
  };
}

/**
 * A vertical ECharts gradient over one of the named ramps.
 *
 * `alpha` fades the whole ramp for the area under a line, where a solid fill
 * would bury the grid. It is applied as a suffix on the hex, which is what the
 * charts already expected.
 */
export function rampStops(
  name: keyof ChartRamps,
  alpha = '',
): { offset: number; color: string }[] {
  const stops = chartChrome().ramps[name];
  const last = stops.length - 1;
  return stops.map((color, i) => ({ offset: last === 0 ? 0 : i / last, color: color + alpha }));
}
