import { ExplorerChain } from '@app/universe/universe.types';

/**
 * The chart child routes each chain offers under its graphs section.
 *
 * One table, used by the chain switcher to decide whether a chart survives a
 * chain switch and by the chain graphs page to build its navigation. A chart
 * missing from a chain's list is not hidden by accident: it either has a
 * different spelling there (see {@link GRAPH_ROUTE_EQUIVALENTS}) or no honest
 * equivalent exists on that chain.
 */
export const CHAIN_GRAPH_CHILDREN: Record<ExplorerChain, readonly string[]> = {
  bitcoin: [
    'mempool',
    'mining/hashrate-difficulty',
    'mining/pools-dominance',
    'mining/pools',
    'mining/block-fees',
    'mining/block-fees-subsidy',
    'mining/block-rewards',
    'mining/block-fee-rates',
    'mining/block-sizes-weights',
    'mining/block-health',
    'price',
  ],
  dogecoin: [
    'mempool',
    'mining/hashrate-difficulty',
    'mining/pools-dominance',
    'mining/pools',
    'mining/block-fees',
    'mining/block-fees-subsidy',
    'mining/block-rewards',
    'mining/block-fee-rates',
    'mining/block-sizes',
    'mining/block-interval',
  ],
  zcash: [
    'mempool',
    'mining/hashrate-difficulty',
    'mining/pools-dominance',
    'mining/pools',
    'mining/block-fees',
    'mining/block-fees-subsidy',
    'mining/block-rewards',
    'mining/block-fee-rates',
    'mining/block-sizes',
    'mining/block-interval',
  ],
};

/**
 * Where a chart keeps its meaning across chains under a different spelling.
 *
 * Bitcoin plots sizes and weights together because segwit gave it two
 * capacity measures; the other chains have one, so their chart is sizes
 * alone. Block health grades Bitcoin blocks against this explorer's own
 * projection, which the other chains honestly cannot have yet, so their
 * nearest reliability reading is the observed against target interval.
 */
const GRAPH_ROUTE_EQUIVALENTS: Record<string, Record<string, string>> = {
  'mining/block-sizes-weights': {
    dogecoin: 'mining/block-sizes',
    zcash: 'mining/block-sizes',
  },
  'mining/block-sizes': {
    bitcoin: 'mining/block-sizes-weights',
  },
  'mining/block-health': {
    dogecoin: 'mining/block-interval',
    zcash: 'mining/block-interval',
  },
  'mining/block-interval': {
    bitcoin: 'mining/block-health',
  },
};

/**
 * The chart child a switch to `targetChain` should land on, or null when the
 * target chain has no equivalent and the switch should land on its graphs
 * landing page instead.
 */
export function equivalentGraphChild(
  child: string,
  targetChain: ExplorerChain
): string | null {
  if (CHAIN_GRAPH_CHILDREN[targetChain].includes(child)) {
    return child;
  }
  const mapped = GRAPH_ROUTE_EQUIVALENTS[child]?.[targetChain];
  return mapped && CHAIN_GRAPH_CHILDREN[targetChain].includes(mapped)
    ? mapped
    : null;
}
