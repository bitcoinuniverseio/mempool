import {
  ExplorerRouteCategory,
  explorerChainFromUrl,
  explorerRouteCategory,
  explorerSectionRoute,
  explorerSwitchTarget,
} from '@app/universe/universe-chain-routing';

describe('Universe chain routing', () => {
  it('treats the shared URL as the source of chain selection', () => {
    expect(explorerChainFromUrl('/dogecoin/tx/abc?view=flow')).toBe('dogecoin');
    expect(explorerChainFromUrl('/zcash')).toBe('zcash');
    expect(explorerChainFromUrl('/tx/abc')).toBe('bitcoin');
  });

  it('maps only equivalent top-level sections between chains', () => {
    expect(explorerSectionRoute('bitcoin', 'mempool')).toBe('/pulse');
    expect(explorerSectionRoute('dogecoin', 'protocols')).toBe(
      '/dogecoin/protocols'
    );
    expect(explorerSwitchTarget('/dogecoin/mempool', 'zcash')).toEqual({
      path: '/zcash/mempool',
      droppedObject: false,
    });
  });

  it('never carries an object identifier into a different chain', () => {
    expect(explorerRouteCategory('/zcash/protocols/zrc20/ZEC')).toBe('object');
    expect(
      explorerSwitchTarget('/zcash/protocols/zrc20/ZEC', 'dogecoin')
    ).toEqual({ path: '/dogecoin', droppedObject: true });
    expect(explorerSwitchTarget('/tx/' + 'a'.repeat(64), 'zcash')).toEqual({
      path: '/zcash',
      droppedObject: true,
    });
  });

  // The route category type is the registry every chain's navigation is built
  // from. Losing a section here silently removes it from every chain's menu,
  // so the full set is pinned.
  it('keeps every product section in the category registry', () => {
    const sections: ExplorerRouteCategory[] = [
      'dashboard', 'mining', 'mempool', 'protocols', 'graphs', 'docs',
    ];
    for (const section of sections) {
      expect(explorerSectionRoute('bitcoin', section as Exclude<ExplorerRouteCategory, 'object'>)).toBeTruthy();
      expect(explorerSectionRoute('dogecoin', section as Exclude<ExplorerRouteCategory, 'object'>)).toContain('/dogecoin');
      expect(explorerSectionRoute('zcash', section as Exclude<ExplorerRouteCategory, 'object'>)).toContain('/zcash');
    }
  });

  it('classifies mining, graphs, and docs URLs as sections, not objects', () => {
    expect(explorerRouteCategory('/mining')).toBe('mining');
    expect(explorerRouteCategory('/dogecoin/mining')).toBe('mining');
    expect(explorerRouteCategory('/zcash/graphs')).toBe('graphs');
    expect(explorerRouteCategory('/graphs/mining/pools')).toBe('graphs');
    expect(explorerRouteCategory('/dogecoin/docs')).toBe('docs');
    expect(explorerRouteCategory('/docs/api')).toBe('docs');
    // A pool page names one pool, which another chain does not have.
    expect(explorerRouteCategory('/mining/pool/foundry')).toBe('object');
  });

  it('preserves the section when switching chains', () => {
    expect(explorerSwitchTarget('/mining', 'dogecoin')).toEqual({
      path: '/dogecoin/mining',
      droppedObject: false,
    });
    expect(explorerSwitchTarget('/dogecoin/mining', 'zcash')).toEqual({
      path: '/zcash/mining',
      droppedObject: false,
    });
    expect(explorerSwitchTarget('/zcash/docs', 'bitcoin')).toEqual({
      path: '/docs',
      droppedObject: false,
    });
  });

  it('preserves a chart child route across chains when an equivalent exists', () => {
    expect(explorerSwitchTarget('/graphs/mining/pools', 'dogecoin')).toEqual({
      path: '/dogecoin/graphs/mining/pools',
      droppedObject: false,
    });
    expect(
      explorerSwitchTarget('/dogecoin/graphs/mining/hashrate-difficulty', 'zcash')
    ).toEqual({
      path: '/zcash/graphs/mining/hashrate-difficulty',
      droppedObject: false,
    });
    // Sizes and weights exist together only on Bitcoin; the others chart sizes.
    expect(
      explorerSwitchTarget('/graphs/mining/block-sizes-weights', 'zcash')
    ).toEqual({
      path: '/zcash/graphs/mining/block-sizes',
      droppedObject: false,
    });
    expect(
      explorerSwitchTarget('/dogecoin/graphs/mining/block-sizes', 'bitcoin')
    ).toEqual({
      path: '/graphs/mining/block-sizes-weights',
      droppedObject: false,
    });
    // The fiat price chart has no self-hosted equivalent on the other chains.
    expect(explorerSwitchTarget('/graphs/price', 'dogecoin')).toEqual({
      path: '/dogecoin/graphs',
      droppedObject: false,
    });
  });
});
