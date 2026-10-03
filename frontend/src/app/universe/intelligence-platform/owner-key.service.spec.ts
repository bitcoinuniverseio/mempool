import { afterEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { OwnerKeyService } from './owner-key.service';
import { StateService } from '@app/services/state.service';

afterEach(() => vi.unstubAllGlobals());
describe('network owner credentials', () => {
  it('partitions stored keys by origin/network and preserves unresolved legacy credentials', () => {
    const stored = new Map([['universe.intelligence.owner-key', 'uip_live_legacy']]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) });
    vi.stubGlobal('location', { origin: 'https://owned.example' });
    const changed = new Subject<string>();
    const state = { network: '', networkChanged$: changed } as unknown as StateService;
    const owner = new OwnerKeyService(state);
    expect(owner.key).toBeNull();
    owner.set('uip_live_mainnet', 'mainnet');
    changed.next('signet');
    expect(owner.headers().has('Authorization')).toBe(false);
    owner.set('uip_live_wrong', 'mainnet');
    expect(owner.key).toBeNull();
    owner.set('uip_live_signet', 'signet');
    changed.next('');
    expect(owner.key).toBe('uip_live_mainnet');
    owner.clear();
    changed.next('signet');
    expect(owner.key).toBe('uip_live_signet');
    vi.stubGlobal('location', { origin: 'https://other.example' });
    expect(new OwnerKeyService(state).key).toBeNull();
    expect(stored.get('universe.intelligence.owner-key')).toBe('uip_live_legacy');
  });
});
