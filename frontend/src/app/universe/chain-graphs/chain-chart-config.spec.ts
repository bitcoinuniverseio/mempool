import { describe, expect, it } from 'vitest';
import {
  CHART_CONFIGS,
  CHART_RANGE_IDS,
  CHART_ROUTE_CHILDREN,
  CHART_SERIES_IDS,
  chartLineLabel,
  unavailableRanges,
} from '@app/universe/chain-graphs/chain-chart-config';
import { CHAIN_GRAPH_CHILDREN } from '@app/universe/universe-chart-registry';

const CHAINS = ['dogecoin', 'zcash'] as const;

describe('graphs routing against the chart registry', () => {
  for (const chain of CHAINS) {
    it(`mounts a route for every ${chain} chart child the registry promises`, () => {
      for (const child of CHAIN_GRAPH_CHILDREN[chain]) {
        const mounted = CHART_ROUTE_CHILDREN.find((entry) => entry.path === child);
        expect(mounted, `registry child "${child}" has no mounted route`).toBeDefined();
      }
    });
  }

  it('has a config for every mounted chart route', () => {
    for (const entry of CHART_ROUTE_CHILDREN) {
      if (entry.chart === null) {
        continue;
      }
      const config = CHART_CONFIGS[entry.chart];
      expect(config, `route "${entry.path}" points at missing config "${entry.chart}"`).toBeDefined();
      expect(config.cards.length).toBeGreaterThan(0);
    }
  });

  it('only asks the backend for series it actually stores', () => {
    const known = new Set<string>(CHART_SERIES_IDS);
    for (const config of Object.values(CHART_CONFIGS)) {
      for (const card of config.cards) {
        expect(card.seriesIds.length).toBeGreaterThan(0);
        for (const seriesId of card.seriesIds) {
          expect(known.has(seriesId), `unknown series "${seriesId}" on card "${card.id}"`).toBe(true);
        }
      }
    }
  });

  it('mounts no route the registry does not promise to some chain', () => {
    const promised = new Set<string>(
      CHAINS.flatMap((chain) => [...CHAIN_GRAPH_CHILDREN[chain]])
    );
    for (const entry of CHART_ROUTE_CHILDREN) {
      expect(promised.has(entry.path), `route "${entry.path}" is not in the registry`).toBe(true);
    }
  });

  it('shows the mempool page three cards, like the Bitcoin mempool graphs', () => {
    expect(CHART_CONFIGS['mempool'].cards.map((card) => card.seriesIds[0])).toEqual([
      'mempool-count',
      'mempool-size',
      'mempool-fees',
    ]);
  });

  it('puts hashrate and difficulty on one card with two axes', () => {
    const card = CHART_CONFIGS['hashrate-difficulty'].cards[0];
    expect(card.seriesIds).toEqual(['hashrate', 'difficulty']);
    expect(card.kind).toBe('dual-axis');
    expect(card.secondaryValueKind).toBe('difficulty');
  });
});

describe('unavailableRanges', () => {
  const now = 1_700_000_000;

  it('disables nothing while the collector has not answered yet', () => {
    expect(unavailableRanges(null, now).size).toBe(0);
  });

  it('disables ranges that reach back before stored history starts', () => {
    const fiveDays = now - 5 * 86_400;
    const blocked = unavailableRanges(fiveDays, now);
    expect(blocked.has('24h')).toBe(false);
    expect(blocked.has('3d')).toBe(false);
    expect(blocked.has('1w')).toBe(true);
    expect(blocked.has('1y')).toBe(true);
  });

  it('never disables the shortest range or all', () => {
    const blocked = unavailableRanges(now, now);
    expect(blocked.has('24h')).toBe(false);
    expect(blocked.has('all')).toBe(false);
  });

  it('disables nothing once history spans the longest range', () => {
    const twoYears = now - 2 * 365 * 86_400;
    expect(unavailableRanges(twoYears, now).size).toBe(0);
  });

  it('answers for every range id it is asked about', () => {
    const blocked = unavailableRanges(now - 1, now);
    for (const range of CHART_RANGE_IDS) {
      expect(typeof blocked.has(range)).toBe('boolean');
    }
  });
});

describe('chartLineLabel', () => {
  it('names the reference and leftover lines', () => {
    expect(chartLineLabel('target')).toBe('Target');
    expect(chartLineLabel('unknown')).toBe('Unknown');
    expect(chartLineLabel('other')).toBe('Other');
  });

  it('spells out percentile keys', () => {
    expect(chartLineLabel('p50')).toContain('50');
    expect(chartLineLabel('p50').toLowerCase()).toContain('percentile');
  });

  it('passes a pool id through untouched, because the id is the only name', () => {
    expect(chartLineLabel('litecoinpool')).toBe('litecoinpool');
  });
});
