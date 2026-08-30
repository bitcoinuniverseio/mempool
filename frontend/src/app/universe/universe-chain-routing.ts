import { ExplorerChain } from '@app/universe/universe.types';
import { equivalentGraphChild } from '@app/universe/universe-chart-registry';

export type ExplorerRouteCategory =
  'dashboard' | 'mining' | 'mempool' | 'protocols' | 'graphs' | 'docs' | 'object';

/**
 * How each chain is written when a person reads it. The wire uses lowercase
 * identifiers; nothing shown to a reader should. One table so a chain is
 * spelled the same way on a page heading, in a saved list, and in a filter.
 */
const CHAIN_NAMES: Record<ExplorerChain, string> = {
  bitcoin: 'Bitcoin',
  dogecoin: 'Dogecoin',
  zcash: 'Zcash',
};

export function explorerChainName(chain: ExplorerChain): string {
  return CHAIN_NAMES[chain] ?? chain;
}

export function explorerChainFromUrl(url: string): ExplorerChain {
  const segment = url.split(/[?#]/, 1)[0].split('/').filter(Boolean)[0];
  return segment === 'dogecoin' || segment === 'zcash' ? segment : 'bitcoin';
}

export function explorerRouteCategory(url: string): ExplorerRouteCategory {
  const segments = url.split(/[?#]/, 1)[0].split('/').filter(Boolean);
  if (segments[0] === 'dogecoin' || segments[0] === 'zcash') {
    segments.shift();
  }
  if (!segments.length) {
    return 'dashboard';
  }
  if (
    segments.length === 1 &&
    (segments[0] === 'mempool' || segments[0] === 'pulse')
  ) {
    return 'mempool';
  }
  if (segments.length === 1 && segments[0] === 'protocols') {
    return 'protocols';
  }
  // The mining dashboard is a section; a pool page under it addresses one
  // pool, which does not exist on another chain, so it stays an object.
  if (segments.length === 1 && segments[0] === 'mining') {
    return 'mining';
  }
  // Every chart child stays inside the graphs section: the switcher decides
  // per chart whether the destination chain has an equivalent.
  if (segments[0] === 'graphs') {
    return 'graphs';
  }
  if (segments[0] === 'docs') {
    return 'docs';
  }
  return 'object';
}

export function explorerSectionRoute(
  chain: ExplorerChain,
  category: Exclude<ExplorerRouteCategory, 'object'>
): string {
  if (chain === 'bitcoin') {
    if (category === 'mempool') {
      return '/pulse';
    }
    return category === 'dashboard' ? '/' : `/${category}`;
  }
  return category === 'dashboard' ? `/${chain}` : `/${chain}/${category}`;
}

/** The chart child path after `graphs/`, or null when the URL is not one. */
function graphChildFrom(url: string): string | null {
  const segments = url.split(/[?#]/, 1)[0].split('/').filter(Boolean);
  if (segments[0] === 'dogecoin' || segments[0] === 'zcash') {
    segments.shift();
  }
  if (segments[0] !== 'graphs' || segments.length < 2) {
    return null;
  }
  return segments.slice(1).join('/');
}

export function explorerSwitchTarget(
  currentUrl: string,
  targetChain: ExplorerChain
): { readonly path: string; readonly droppedObject: boolean } {
  const category = explorerRouteCategory(currentUrl);
  if (category === 'object') {
    return {
      path: explorerSectionRoute(targetChain, 'dashboard'),
      droppedObject: true,
    };
  }
  if (category === 'graphs') {
    const child = graphChildFrom(currentUrl);
    const equivalent = child ? equivalentGraphChild(child, targetChain) : null;
    return {
      path: equivalent
        ? `${explorerSectionRoute(targetChain, 'graphs')}/${equivalent}`
        : explorerSectionRoute(targetChain, 'graphs'),
      droppedObject: false,
    };
  }
  return {
    path: explorerSectionRoute(targetChain, category),
    droppedObject: false,
  };
}
