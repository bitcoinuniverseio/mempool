import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chainNetwork, configuredChainNetworks } from '@app/universe/chain-network';

describe('chainNetwork', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  beforeEach(() => { warn.mockClear(); configuredChainNetworks({}); });
  afterEach(() => { configuredChainNetworks({}); });

  it('reads mainnet for every non-Bitcoin chain when nothing is configured', () => {
    for (const env of [undefined, null, {}, { UNIVERSE_CHAIN_NETWORKS: undefined }, { UNIVERSE_CHAIN_NETWORKS: '' }, { UNIVERSE_CHAIN_NETWORKS: {} }]) {
      expect(chainNetwork('dogecoin', 'signet', env)).toBe('mainnet');
      expect(chainNetwork('zcash', 'signet', env)).toBe('mainnet');
      expect(chainNetwork('fractal', 'signet', env)).toBe('mainnet');
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('gives Bitcoin the selected network and never the other way round', () => {
    const env = { UNIVERSE_CHAIN_NETWORKS: { dogecoin: 'testnet', zcash: 'regtest' } };
    expect(chainNetwork('bitcoin', 'signet', env)).toBe('signet');
    expect(chainNetwork('bitcoin', 'mainnet', env)).toBe('mainnet');
    expect(chainNetwork('dogecoin', 'signet', env)).toBe('testnet');
    expect(chainNetwork('dogecoin', 'mainnet', env)).toBe('testnet');
    expect(chainNetwork('zcash', 'testnet4', env)).toBe('regtest');
  });

  it('parses the JSON-string form and warns once for a value it cannot use', () => {
    expect(chainNetwork('dogecoin', 'mainnet', { UNIVERSE_CHAIN_NETWORKS: '{"dogecoin":"testnet"}' })).toBe('testnet');
    const env = { UNIVERSE_CHAIN_NETWORKS: '{"dogecoin":"signet","zcash":"testnet"}' };
    expect(chainNetwork('dogecoin', 'mainnet', env)).toBe('mainnet');
    expect(chainNetwork('zcash', 'mainnet', env)).toBe('testnet');
    expect(chainNetwork('dogecoin', 'mainnet', env)).toBe('mainnet');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/UNIVERSE_CHAIN_NETWORKS .*dogecoin .*signet/);
  });

  it.each(['{', 'testnet', 7, true, ['testnet'], { dogecoin: 'testnet3' }, { bitcoin: 'signet' }])('ignores %j with a warning', (value) => {
    expect(chainNetwork('dogecoin', 'mainnet', { UNIVERSE_CHAIN_NETWORKS: value })).toBe('mainnet');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
