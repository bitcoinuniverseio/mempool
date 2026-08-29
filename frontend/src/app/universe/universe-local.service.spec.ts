import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UniverseLocalService } from '@app/universe/universe-local.service';

/** Minimal in-memory stand-in for the browser store. */
function installStorage(seed: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(seed));
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string): string | null => (store.has(key) ? store.get(key) : null),
    setItem: (key: string, value: string): void => void store.set(key, value),
    removeItem: (key: string): void => void store.delete(key),
  };
  return store;
}

function service(isBrowser = true): UniverseLocalService {
  return new UniverseLocalService({ isBrowser } as never);
}

const ENTRY = {
  kind: 'transaction' as const,
  value: 'a'.repeat(64),
  path: `/tx/${'a'.repeat(64)}`,
  label: 'aaaaaaaa',
};

describe('UniverseLocalService', () => {
  beforeEach(() => {
    installStorage();
  });

  it('does nothing at all outside a browser', () => {
    const local = service(false);
    local.recordVisit(ENTRY);
    expect(local.recentSnapshot()).toEqual([]);
    expect(local.toggleBookmark(ENTRY)).toBe(false);
  });

  it('records a visit and keeps the most recent first', () => {
    const local = service();
    local.recordVisit(ENTRY);
    local.recordVisit({ ...ENTRY, value: 'b'.repeat(64), label: 'bbbbbbbb' });
    expect(local.recentSnapshot().map((entry) => entry.label)).toEqual(['bbbbbbbb', 'aaaaaaaa']);
  });

  it('collapses a repeated visit into one entry', () => {
    const local = service();
    local.recordVisit(ENTRY);
    local.recordVisit({ ...ENTRY, value: 'b'.repeat(64) });
    local.recordVisit(ENTRY);
    const recent = local.recentSnapshot();
    expect(recent).toHaveLength(2);
    expect(recent[0].value).toBe(ENTRY.value);
  });

  it('caps the recent list', () => {
    const local = service();
    for (let index = 0; index < 20; index += 1) {
      local.recordVisit({ ...ENTRY, value: `${index}`.padStart(64, '0'), label: `entry ${index}` });
    }
    expect(local.recentSnapshot().length).toBeLessThanOrEqual(8);
  });

  it('toggles a bookmark on and off', () => {
    const local = service();
    expect(local.toggleBookmark(ENTRY)).toBe(true);
    expect(local.isBookmarked('transaction', ENTRY.value)).toBe(true);
    expect(local.toggleBookmark(ENTRY)).toBe(false);
    expect(local.isBookmarked('transaction', ENTRY.value)).toBe(false);
  });

  it('treats the same value under different kinds as different entries', () => {
    const local = service();
    local.toggleBookmark(ENTRY);
    local.toggleBookmark({ ...ENTRY, kind: 'block', path: `/block/${ENTRY.value}` });
    expect(local.isBookmarked('transaction', ENTRY.value)).toBe(true);
    expect(local.isBookmarked('block', ENTRY.value)).toBe(true);
  });

  it('treats the same kind and value on different chains as different entries', () => {
    const local = service();
    local.toggleBookmark(ENTRY);
    local.toggleBookmark({ ...ENTRY, chain: 'dogecoin', path: `/dogecoin/tx/${ENTRY.value}` });
    expect(local.isBookmarked('transaction', ENTRY.value, 'bitcoin')).toBe(true);
    expect(local.isBookmarked('transaction', ENTRY.value, 'dogecoin')).toBe(true);
  });

  it('refuses an entry whose path is not a local route', () => {
    const local = service();
    expect(local.toggleBookmark({ ...ENTRY, path: 'https://example.invalid/tx' })).toBe(false);
    expect(local.isBookmarked('transaction', ENTRY.value)).toBe(false);
  });

  it('discards stored junk instead of trusting it', () => {
    installStorage({
      'universe.recent.v1': JSON.stringify([
        { kind: 'transaction' },
        { kind: 'block', value: 'x', path: '/block/x', label: 'x', at: 1 },
        'not an object',
      ]),
    });
    const local = service();
    expect(local.recentSnapshot()).toMatchObject([
      { value: 'x', chain: 'bitcoin', network: 'mainnet' },
    ]);
  });

  it('migrates version one entries to explicit Bitcoin mainnet identity', () => {
    const store = installStorage({
      'universe.bookmarks.v1': JSON.stringify([{ ...ENTRY, at: 1 }]),
    });
    const local = service();
    expect(local.isBookmarked('transaction', ENTRY.value, 'bitcoin', 'mainnet')).toBe(true);
    expect(JSON.parse(store.get('universe.bookmarks.v2'))[0]).toMatchObject({
      chain: 'bitcoin',
      network: 'mainnet',
    });
  });

  it('survives a store that throws on every access', () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (): string => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
      removeItem: (): void => {
        throw new Error('blocked');
      },
    };
    const local = service();
    expect(local.recentSnapshot()).toEqual([]);
    expect(() => local.recordVisit(ENTRY)).not.toThrow();
    expect(() => local.resetAll()).not.toThrow();
  });

  it('keeps only well formed protocol ids when pinning', () => {
    const local = service();
    local.setPreferences({ pinnedProtocols: ['runes', 'ordinals'] });
    local.togglePinnedProtocol('runes');
    local.setSelectedChain('zcash');
    let pinned: readonly string[] = [];
    local.preferences$.subscribe((preferences) => {
      pinned = preferences.pinnedProtocols;
    }).unsubscribe();
    expect(pinned).toEqual(['ordinals']);
  });

  it('rejects a stored pin that is not a protocol id', () => {
    installStorage({
      'universe.preferences.v1': JSON.stringify({
        pinnedProtocols: ['runes', 'NOT VALID', 42],
        animatePulse: false,
      }),
    });
    const local = service();
    let pinned: readonly string[] = [];
    let animate = true;
    local.preferences$.subscribe((preferences) => {
      pinned = preferences.pinnedProtocols;
      animate = preferences.animatePulse;
    }).unsubscribe();
    expect(pinned).toEqual(['runes']);
    expect(animate).toBe(false);
  });

  it('forgets everything on reset', () => {
    const store = installStorage();
    const local = service();
    local.recordVisit(ENTRY);
    local.toggleBookmark(ENTRY);
    local.togglePinnedProtocol('runes');
    local.resetAll();
    expect(local.recentSnapshot()).toEqual([]);
    expect(local.isBookmarked('transaction', ENTRY.value)).toBe(false);
    expect(store.has('universe.recent.v2')).toBe(false);
    expect(store.has('universe.bookmarks.v2')).toBe(false);
    expect(store.has('universe.preferences.v2')).toBe(false);
  });

  it('never writes anything that was not asked for', () => {
    const store = installStorage();
    const local = service();
    local.recordVisit(ENTRY);
    expect([...store.keys()]).toEqual(['universe.recent.v2']);
    const written = JSON.parse(store.get('universe.recent.v2'));
    expect(Object.keys(written[0]).sort()).toEqual([
      'at', 'chain', 'kind', 'label', 'network', 'path', 'value',
    ]);
  });

  it('stores a selected chain preference without changing a shared URL', () => {
    const store = installStorage();
    const local = service();
    local.setSelectedChain('dogecoin');
    expect(local.selectedChainSnapshot()).toBe('dogecoin');
    expect(JSON.parse(store.get('universe.preferences.v2')).selectedChain).toBe('dogecoin');
  });

  it('truncates an over-long label rather than storing it whole', () => {
    const local = service();
    local.recordVisit({ ...ENTRY, label: 'x'.repeat(500) });
    expect(local.recentSnapshot()[0].label.length).toBe(120);
  });
});

describe('UniverseLocalService time handling', () => {
  it('stamps entries with the current time', () => {
    installStorage();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const local = service();
    local.recordVisit(ENTRY);
    expect(local.recentSnapshot()[0].at).toBe(1_700_000_000_000);
    spy.mockRestore();
  });
});
