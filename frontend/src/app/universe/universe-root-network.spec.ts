import { describe, expect, it, vi } from 'vitest';
import { Subject, of } from 'rxjs';
import { UniverseApiService } from './universe-api.service';

function setup(network: string, rootNetwork?: string) {
  const state = { isBrowser: true, network, env: { ROOT_NETWORK: rootNetwork }, networkChanged$: new Subject<string>() };
  const get = vi.fn(() => of({}));
  const api = new UniverseApiService({ get } as any, state as any, { headers: () => ({}), key: null } as any);
  return { api, state, get };
}

describe('Universe selected root deployment network', () => {
  it.each(['signet', 'regtest', 'testnet', 'testnet4'])('binds an empty selector to the configured %s root', root => {
    const { api, get } = setup('', root);
    expect(api.network).toBe(root);
    api.getBolt12Offers$(20).subscribe();
    expect(get.mock.calls[0][0]).toBe('/api/v1/lightning/offers?limit=20');
  });
  it('keeps an explicit selection authoritative over the root deployment', () => {
    const { api, get } = setup('regtest', 'signet');
    expect(api.network).toBe('regtest');
    api.getBolt12Offers$(20).subscribe();
    expect(get.mock.calls[0][0]).toBe('/regtest/api/v1/lightning/offers?limit=20');
  });
  it('preserves mainnet when the root deployment is unspecified', () => {
    expect(setup('').api.network).toBe('mainnet');
    expect(setup('mainnet', 'signet').api.network).toBe('mainnet');
  });
  it('rejects an unsupported root rather than relabelling it mainnet', () => {
    expect(() => setup('', 'foreign').api.network).toThrow('unsupported-overlay-network');
  });
  it('emits root and explicit network transitions from the same selected context', () => {
    const { api, state } = setup('', 'signet');
    const selected: string[] = [];
    const read = api.selectedNetwork$().subscribe(value => selected.push(value));
    state.network = 'regtest'; state.networkChanged$.next('regtest');
    state.network = ''; state.networkChanged$.next('');
    expect(selected).toEqual(['signet', 'regtest', 'signet']);
    read.unsubscribe();
  });
});
