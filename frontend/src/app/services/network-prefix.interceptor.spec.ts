import { describe, expect, it } from 'vitest';
import { networkScopedUrl } from './network-prefix.interceptor';

const state = (network: string, env: Record<string, unknown> = { ROOT_NETWORK: 'mainnet', BASE_MODULE: 'mempool' }) => ({ network, env } as never);

describe('network prefix for backend-owned requests', () => {
  it('sends backend-owned intelligence and tool routes to the selected network backend', () => {
    expect(networkScopedUrl('/api/v1/intelligence/collaborative/overview', state('signet'))).toBe('/signet/api/v1/intelligence/collaborative/overview');
    expect(networkScopedUrl('/api/v1/taproot-assets/assets', state('testnet4'))).toBe('/testnet4/api/v1/taproot-assets/assets');
    expect(networkScopedUrl('/api/v1/intelligence/swaps/overview?network=signet', state('signet'))).toBe('/signet/api/v1/intelligence/swaps/overview?network=signet');
    expect(networkScopedUrl('/api/v1/backend-info', state('testnet'))).toBe('/testnet/api/v1/backend-info');
  });

  it.each(['', 'mainnet'])('leaves the root network %j on the root backend', network => {
    expect(networkScopedUrl('/api/v1/intelligence/timestamps/overview', state(network))).toBe('/api/v1/intelligence/timestamps/overview');
  });

  it('leaves overlay families, other chains, already prefixed and foreign URLs alone', () => {
    for (const url of [
      '/api/v1/universe/protocols?chain=bitcoin&network=signet', '/api/v1/chains?network=signet', '/api/v1/bitcoin/status',
      '/api/v1/dogecoin/dashboard', '/api/v1/zcash/dashboard', '/api/v1/anima/status', '/api/v1/fractal/tip', '/api/v1/liquid/observatory/summary',
      '/signet/api/v1/intelligence/timestamps/overview', '/api/v2/universe/portfolios', '/api/blocks/tip/height', 'https://elsewhere.example/api/v1/node/overview',
      '/resources/pools.json',
    ]) {
      expect(networkScopedUrl(url, state('signet'))).toBe(url);
    }
  });

  it('handles the server build origin and a non-mempool base module', () => {
    const ssr = state('signet', { ROOT_NETWORK: 'mainnet', BASE_MODULE: 'mempool', NGINX_PROTOCOL: 'https', NGINX_HOSTNAME: 'explorer.internal', NGINX_PORT: '443' });
    expect(networkScopedUrl('https://explorer.internal:443/api/v1/node/overview', ssr)).toBe('https://explorer.internal:443/signet/api/v1/node/overview');
    expect(networkScopedUrl('/api/v1/node/overview', state('liquidtestnet', { ROOT_NETWORK: 'liquid', BASE_MODULE: 'liquid' }))).toBe('/api/v1/node/overview');
  });
});
