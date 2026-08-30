/**
 * The chart pages the Dogecoin and Zcash graphs section serves.
 *
 * Pure data and pure helpers, no Angular imports beyond $localize, so the
 * regression spec can assert that every chart child the registry promises for
 * a chain is actually mounted here, without compiling a component.
 */

/** Series the backend stores. Anything a card asks for must be in this list. */
export const CHART_SERIES_IDS = [
  'mempool-count',
  'mempool-size',
  'mempool-fees',
  'block-fees',
  'block-rewards',
  'block-fees-subsidy',
  'block-fee-rates',
  'block-sizes',
  'block-count',
  'block-interval',
  'difficulty',
  'hashrate',
  'pools-dominance',
] as const;

export type ChartSeriesId = typeof CHART_SERIES_IDS[number];

export const CHART_RANGE_IDS = ['24h', '3d', '1w', '1m', '3m', '6m', '1y', 'all'] as const;

export type ChartRangeId = typeof CHART_RANGE_IDS[number];

const DAY = 86_400;

/** How far back each range asks, in seconds. 'all' has no fixed span. */
export const CHART_RANGE_SECONDS: Record<Exclude<ChartRangeId, 'all'>, number> = {
  '24h': DAY,
  '3d': 3 * DAY,
  '1w': 7 * DAY,
  '1m': 30 * DAY,
  '3m': 90 * DAY,
  '6m': 182 * DAY,
  '1y': 365 * DAY,
};

/**
 * Ranges the collector cannot fill yet, given when its stored history starts.
 *
 * A range is out of reach when it asks further back than the earliest stored
 * bucket. The shortest range stays offered so there is always a live page,
 * and 'all' stays offered because it means exactly what is stored, however
 * little that is.
 */
export function unavailableRanges(
  earliestSeconds: number | null,
  nowSeconds: number
): ReadonlySet<ChartRangeId> {
  const out = new Set<ChartRangeId>();
  if (earliestSeconds === null || !Number.isFinite(earliestSeconds)) {
    return out;
  }
  const available = Math.max(0, nowSeconds - earliestSeconds);
  for (const range of CHART_RANGE_IDS) {
    if (range === 'all' || range === '24h') {
      continue;
    }
    if (CHART_RANGE_SECONDS[range] > available) {
      out.add(range);
    }
  }
  return out;
}

/** How the lines of one card are drawn together. */
export type ChartCardKind =
  | 'line'
  | 'area'
  | 'stacked-area'
  | 'multi-line'
  | 'dual-axis';

/** What the numbers on an axis mean, which decides how they are written. */
export type ChartValueKind =
  | 'count'
  | 'bytes'
  | 'atomic-amount'
  | 'fee-rate'
  | 'seconds'
  | 'difficulty'
  | 'rate'
  | 'share';

export interface ChartCardConfig {
  /** Stable id for captions and per-card view state. */
  readonly id: string;
  readonly title: string;
  /** The backend series this card fetches. Order fixes axis assignment. */
  readonly seriesIds: readonly ChartSeriesId[];
  readonly kind: ChartCardKind;
  readonly valueKind: ChartValueKind;
  /** On a dual-axis card, what the right-hand axis measures. */
  readonly secondaryValueKind?: ChartValueKind;
}

export interface ChartPageConfig {
  readonly id: string;
  /** Page heading and navigation label. */
  readonly title: string;
  readonly cards: readonly ChartCardConfig[];
}

/**
 * One config per chart page. The mempool page stacks three cards, matching
 * the Bitcoin graphs page that shows several mempool graphs together; the
 * task's flat one-config-one-series shape could not say that three cards with
 * three different value kinds share one page, so a config holds cards.
 */
export const CHART_CONFIGS: Record<string, ChartPageConfig> = {
  'mempool': {
    id: 'mempool',
    title: $localize`:@@universe.graphs.page-mempool:Mempool`,
    cards: [
      {
        id: 'mempool-count',
        title: $localize`:@@universe.graphs.card-mempool-count:Pending transactions`,
        seriesIds: ['mempool-count'],
        kind: 'line',
        valueKind: 'count',
      },
      {
        id: 'mempool-size',
        title: $localize`:@@universe.graphs.card-mempool-size:Pending set size`,
        seriesIds: ['mempool-size'],
        kind: 'area',
        valueKind: 'bytes',
      },
      {
        id: 'mempool-fees',
        title: $localize`:@@universe.graphs.card-mempool-fees:Pending fees`,
        seriesIds: ['mempool-fees'],
        kind: 'area',
        valueKind: 'atomic-amount',
      },
    ],
  },
  'hashrate-difficulty': {
    id: 'hashrate-difficulty',
    title: $localize`:@@universe.graphs.page-hashrate:Hashrate and difficulty`,
    cards: [
      {
        id: 'hashrate-difficulty',
        title: $localize`:@@universe.graphs.card-hashrate:Network rate and difficulty`,
        seriesIds: ['hashrate', 'difficulty'],
        kind: 'dual-axis',
        valueKind: 'rate',
        secondaryValueKind: 'difficulty',
      },
    ],
  },
  'pools-dominance': {
    id: 'pools-dominance',
    title: $localize`:@@universe.graphs.page-dominance:Pools dominance`,
    cards: [
      {
        id: 'pools-dominance',
        title: $localize`:@@universe.graphs.card-dominance:Share of blocks by pool`,
        seriesIds: ['pools-dominance'],
        kind: 'stacked-area',
        valueKind: 'share',
      },
    ],
  },
  'block-fees': {
    id: 'block-fees',
    title: $localize`:@@universe.graphs.page-block-fees:Block fees`,
    cards: [
      {
        id: 'block-fees',
        title: $localize`:@@universe.graphs.card-block-fees:Fees per block`,
        seriesIds: ['block-fees'],
        kind: 'area',
        valueKind: 'atomic-amount',
      },
    ],
  },
  'block-fees-subsidy': {
    id: 'block-fees-subsidy',
    title: $localize`:@@universe.graphs.page-fees-subsidy:Block fees versus subsidy`,
    cards: [
      {
        id: 'block-fees-subsidy',
        title: $localize`:@@universe.graphs.card-fees-subsidy:Fees and subsidy per block`,
        seriesIds: ['block-fees-subsidy'],
        kind: 'stacked-area',
        valueKind: 'atomic-amount',
      },
    ],
  },
  'block-rewards': {
    id: 'block-rewards',
    title: $localize`:@@universe.graphs.page-block-rewards:Block rewards`,
    cards: [
      {
        id: 'block-rewards',
        title: $localize`:@@universe.graphs.card-block-rewards:Total reward per block`,
        seriesIds: ['block-rewards'],
        kind: 'area',
        valueKind: 'atomic-amount',
      },
    ],
  },
  'block-fee-rates': {
    id: 'block-fee-rates',
    title: $localize`:@@universe.graphs.page-fee-rates:Block fee rates`,
    cards: [
      {
        id: 'block-fee-rates',
        title: $localize`:@@universe.graphs.card-fee-rates:Fee rates in mined blocks`,
        seriesIds: ['block-fee-rates'],
        kind: 'multi-line',
        valueKind: 'fee-rate',
      },
    ],
  },
  'block-sizes': {
    id: 'block-sizes',
    title: $localize`:@@universe.graphs.page-block-sizes:Block sizes`,
    cards: [
      {
        id: 'block-sizes',
        title: $localize`:@@universe.graphs.card-block-sizes:Size per block`,
        seriesIds: ['block-sizes'],
        kind: 'area',
        valueKind: 'bytes',
      },
    ],
  },
  'block-interval': {
    id: 'block-interval',
    title: $localize`:@@universe.graphs.page-block-interval:Block interval`,
    cards: [
      {
        id: 'block-interval',
        title: $localize`:@@universe.graphs.card-block-interval:Observed interval against target`,
        seriesIds: ['block-interval'],
        kind: 'multi-line',
        valueKind: 'seconds',
      },
    ],
  },
};

export interface ChartRouteChild {
  /** The path after `graphs/`, exactly as the chart registry spells it. */
  readonly path: string;
  /** The CHART_CONFIGS key, or null where the child is not a series chart. */
  readonly chart: string | null;
}

/**
 * The children the graphs section mounts, one per registry entry for
 * Dogecoin and Zcash. The module builds its routes from this table and the
 * spec checks it against the registry, so a chart promised by the registry
 * cannot silently have no page.
 */
export const CHART_ROUTE_CHILDREN: readonly ChartRouteChild[] = [
  { path: 'mempool', chart: 'mempool' },
  { path: 'mining/hashrate-difficulty', chart: 'hashrate-difficulty' },
  { path: 'mining/pools-dominance', chart: 'pools-dominance' },
  { path: 'mining/pools', chart: null },
  { path: 'mining/block-fees', chart: 'block-fees' },
  { path: 'mining/block-fees-subsidy', chart: 'block-fees-subsidy' },
  { path: 'mining/block-rewards', chart: 'block-rewards' },
  { path: 'mining/block-fee-rates', chart: 'block-fee-rates' },
  { path: 'mining/block-sizes', chart: 'block-sizes' },
  { path: 'mining/block-interval', chart: 'block-interval' },
];

/** Line keys that name a leftover bucket rather than a real series. */
export const MUTED_LINE_KEYS: ReadonlySet<string> = new Set(['unknown', 'other']);

/** Line keys drawn as a reference rather than an observation. */
export const REFERENCE_LINE_KEYS: ReadonlySet<string> = new Set(['target']);

const LINE_LABELS: Record<string, string> = {
  count: $localize`:@@universe.graphs.line-count:Transactions`,
  size: $localize`:@@universe.graphs.line-size:Size`,
  bytes: $localize`:@@universe.graphs.line-bytes:Bytes`,
  fees: $localize`:@@universe.graphs.line-fees:Fees`,
  subsidy: $localize`:@@universe.graphs.line-subsidy:Subsidy`,
  reward: $localize`:@@universe.graphs.line-reward:Reward`,
  rewards: $localize`:@@universe.graphs.line-rewards:Rewards`,
  hashrate: $localize`:@@universe.graphs.line-hashrate:Network rate`,
  difficulty: $localize`:@@universe.graphs.line-difficulty:Difficulty`,
  observed: $localize`:@@universe.graphs.line-observed:Observed`,
  mean: $localize`:@@universe.graphs.line-mean:Observed mean`,
  median: $localize`:@@universe.graphs.line-median:Median`,
  min: $localize`:@@universe.graphs.line-min:Minimum`,
  max: $localize`:@@universe.graphs.line-max:Maximum`,
  avg: $localize`:@@universe.graphs.line-avg:Average`,
  interval: $localize`:@@universe.graphs.line-interval:Observed interval`,
  target: $localize`:@@universe.graphs.line-target:Target`,
  unknown: $localize`:@@universe.graphs.line-unknown:Unknown`,
  other: $localize`:@@universe.graphs.line-other:Other`,
};

const PERCENTILE = /^p(\d{1,2})$/;

/**
 * The name a line wears in the legend, the tooltip, and the table header.
 * Pool ids on the dominance chart pass through as they are, because the id
 * is the only name the series carries.
 */
export function chartLineLabel(key: string): string {
  const known = LINE_LABELS[key];
  if (known) {
    return known;
  }
  const percentile = PERCENTILE.exec(key);
  if (percentile) {
    return $localize`:@@universe.graphs.line-percentile:${percentile[1]}:PERCENTILE:th percentile`;
  }
  return key;
}
