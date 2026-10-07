import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainNetworkUnavailableError,
  chainNetwork,
  configuredChainNetworks,
  resolveChainNetwork,
} from '@app/universe/chain-network';

describe('chainNetwork', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  beforeEach(() => { configuredChainNetworks({}); warn.mockClear(); });
  afterEach(() => { configuredChainNetworks({}); });

  it('reads mainnet for every non-Bitcoin chain when nothing is configured', () => {
    for (const env of [undefined, null, {}, { UNIVERSE_CHAIN_NETWORKS: undefined }, { UNIVERSE_CHAIN_NETWORKS: '' }, { UNIVERSE_CHAIN_NETWORKS: {} }, { UNIVERSE_CHAIN_NETWORKS: '{}' }]) {
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

  it('keeps an omitted chain on mainnet beside a configured one', () => {
    const env = { UNIVERSE_CHAIN_NETWORKS: { dogecoin: 'testnet' } };
    expect(chainNetwork('zcash', 'signet', env)).toBe('mainnet');
    expect(chainNetwork('fractal', 'signet', env)).toBe('mainnet');
  });

  it('parses the JSON-string form the Docker environment supplies', () => {
    expect(chainNetwork('dogecoin', 'mainnet', { UNIVERSE_CHAIN_NETWORKS: '{"dogecoin":"testnet"}' })).toBe('testnet');
    expect(chainNetwork('fractal', 'mainnet', { UNIVERSE_CHAIN_NETWORKS: '{"fractal":"testnet"}' })).toBe('testnet');
    expect(warn).not.toHaveBeenCalled();
  });

  it('makes only the chain with an unsupported network unavailable, never mainnet', () => {
    const env = { UNIVERSE_CHAIN_NETWORKS: '{"dogecoin":"signet","zcash":"testnet"}' };
    const dogecoin = resolveChainNetwork('dogecoin', 'mainnet', env);
    expect(dogecoin.available).toBe(false);
    expect(dogecoin.network).toBeNull();
    expect(dogecoin.reason).toMatch(/UNIVERSE_CHAIN_NETWORKS names "signet" for dogecoin/);
    expect(() => chainNetwork('dogecoin', 'mainnet', env)).toThrow(ChainNetworkUnavailableError);
    expect(chainNetwork('zcash', 'mainnet', env)).toBe('testnet');
    expect(chainNetwork('bitcoin', 'signet', env)).toBe('signet');
    // Memoized: one warning for the setting, not one per read.
    resolveChainNetwork('dogecoin', 'mainnet', env);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('refuses a network the owning contract does not list for that chain', () => {
    expect(resolveChainNetwork('fractal', 'mainnet', { UNIVERSE_CHAIN_NETWORKS: { fractal: 'regtest' } }).available).toBe(false);
    expect(resolveChainNetwork('dogecoin', 'mainnet', { UNIVERSE_CHAIN_NETWORKS: { dogecoin: 'testnet3' } }).available).toBe(false);
    expect(resolveChainNetwork('dogecoin', 'mainnet', { UNIVERSE_CHAIN_NETWORKS: { dogecoin: 'Testnet' } }).available).toBe(false);
    expect(resolveChainNetwork('dogecoin', 'mainnet', { UNIVERSE_CHAIN_NETWORKS: { dogecoin: 7 } }).available).toBe(false);
  });

  it.each([
    ['{', /is not valid JSON/],
    ['testnet', /is not valid JSON/],
    [7, /must be a JSON object/],
    [true, /must be a JSON object/],
    [['testnet'], /must be a JSON object/],
    ['[]', /must be a JSON object/],
    [{ bitcoin: 'signet' }, /cannot name a Bitcoin network/],
    [{ doge: 'testnet' }, /names "doge", which is not a chain/],
    [{ dogecoin: 'testnet', litecoin: 'testnet' }, /names "litecoin", which is not a chain/],
  ])('makes every configurable chain unavailable for the unreadable map %j', (value, reason) => {
    const env = { UNIVERSE_CHAIN_NETWORKS: value };
    for (const chain of ['dogecoin', 'zcash', 'fractal']) {
      const resolved = resolveChainNetwork(chain, 'mainnet', env);
      expect(resolved.available).toBe(false);
      expect(resolved.reason).toMatch(reason);
      let failure: unknown;
      try { chainNetwork(chain, 'mainnet', env); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(ChainNetworkUnavailableError);
      expect((failure as ChainNetworkUnavailableError).chain).toBe(chain);
    }
    // Bitcoin never reads this map, so its selector still stands.
    expect(chainNetwork('bitcoin', 'signet', env)).toBe('signet');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('names a chain this explorer does not read as unavailable rather than mainnet', () => {
    const resolved = resolveChainNetwork('litecoin', 'mainnet', {});
    expect(resolved.available).toBe(false);
    expect(resolved.reason).toMatch(/not a chain this explorer reads/);
  });

  it('recovers as soon as the setting is corrected', () => {
    expect(resolveChainNetwork('dogecoin', 'mainnet', { UNIVERSE_CHAIN_NETWORKS: '{"dogecoin":' }).available).toBe(false);
    expect(chainNetwork('dogecoin', 'mainnet', { UNIVERSE_CHAIN_NETWORKS: '{"dogecoin":"testnet"}' })).toBe('testnet');
    expect(resolveChainNetwork('dogecoin', 'mainnet', { UNIVERSE_CHAIN_NETWORKS: { dogecoin: 'signet' } }).available).toBe(false);
    expect(chainNetwork('dogecoin', 'mainnet', {})).toBe('mainnet');
  });
});
