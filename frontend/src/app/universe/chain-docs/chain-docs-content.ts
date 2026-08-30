/**
 * The section manifest for the chain docs page.
 *
 * One typed list so the sidebar, the deep-link routing, and the regression
 * spec all agree on which sections exist for which chain. The section bodies
 * themselves live in the component template, gated by chain, because prose in
 * a template keeps the i18n extraction working; a markdown renderer would put
 * every sentence outside it.
 */

export type DocsChain = 'dogecoin' | 'zcash';

export interface DocsSection {
  /** The anchor id, the route segment, and the spec's key, all one string. */
  readonly id: string;
  readonly title: string;
  readonly chainScope: 'both' | DocsChain;
}

export const DOCS_SECTIONS: readonly DocsSection[] = [
  {
    id: 'overview',
    title: $localize`:@@universe.docs.nav-overview:Overview`,
    chainScope: 'both',
  },
  {
    id: 'dashboard',
    title: $localize`:@@universe.docs.nav-dashboard:Dashboard`,
    chainScope: 'both',
  },
  {
    id: 'timeline',
    title: $localize`:@@universe.docs.nav-timeline:Block timeline`,
    chainScope: 'both',
  },
  {
    id: 'candidate-blocks',
    title: $localize`:@@universe.docs.nav-candidate:Candidate blocks`,
    chainScope: 'both',
  },
  {
    id: 'fees',
    title: $localize`:@@universe.docs.nav-fees:Fees`,
    chainScope: 'both',
  },
  {
    id: 'mempool',
    title: $localize`:@@universe.docs.nav-mempool:Pending transactions`,
    chainScope: 'both',
  },
  {
    id: 'lookups',
    title: $localize`:@@universe.docs.nav-lookups:Lookups`,
    chainScope: 'both',
  },
  {
    id: 'mining',
    title: $localize`:@@universe.docs.nav-mining:Mining`,
    chainScope: 'both',
  },
  {
    id: 'pool-attribution',
    title: $localize`:@@universe.docs.nav-pools:Pool attribution`,
    chainScope: 'both',
  },
  {
    id: 'charts',
    title: $localize`:@@universe.docs.nav-charts:Charts`,
    chainScope: 'both',
  },
  {
    id: 'privacy',
    title: $localize`:@@universe.docs.nav-privacy:Privacy`,
    chainScope: 'zcash',
  },
  {
    id: 'freshness',
    title: $localize`:@@universe.docs.nav-freshness:Freshness`,
    chainScope: 'both',
  },
  {
    id: 'api',
    title: $localize`:@@universe.docs.nav-api:API`,
    chainScope: 'both',
  },
  {
    id: 'versions',
    title: $localize`:@@universe.docs.nav-versions:Versions`,
    chainScope: 'both',
  },
];

/** The sections a chain's docs page shows, in page order. */
export function docsSectionsFor(chain: DocsChain): readonly DocsSection[] {
  return DOCS_SECTIONS.filter(
    (section) => section.chainScope === 'both' || section.chainScope === chain
  );
}
