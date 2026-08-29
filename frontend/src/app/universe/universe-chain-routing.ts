import { ExplorerChain } from '@app/universe/universe.types';

export type ExplorerRouteCategory =
  'dashboard' | 'mempool' | 'protocols' | 'object';

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
    if (category === 'protocols') {
      return '/protocols';
    }
    return '/';
  }
  return category === 'dashboard' ? `/${chain}` : `/${chain}/${category}`;
}

export function explorerSwitchTarget(
  currentUrl: string,
  targetChain: ExplorerChain
): { readonly path: string; readonly droppedObject: boolean } {
  const category = explorerRouteCategory(currentUrl);
  return category === 'object'
    ? {
        path: explorerSectionRoute(targetChain, 'dashboard'),
        droppedObject: true,
      }
    : {
        path: explorerSectionRoute(targetChain, category),
        droppedObject: false,
      };
}
