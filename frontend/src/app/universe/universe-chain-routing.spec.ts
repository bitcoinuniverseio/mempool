import {
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
});
