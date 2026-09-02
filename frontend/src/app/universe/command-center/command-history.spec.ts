import { describe, expect, it } from 'vitest';

import { loadRecent, loadSaved, pushRecent, removeSaved, saveQuery } from './command-history';

/** A storage that behaves, for the happy paths. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

describe('recent queries', () => {
  it('is empty when storage says nothing or refuses', () => {
    expect(loadRecent(null)).toEqual([]);
    const refusing = { getItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(loadRecent(refusing)).toEqual([]);
  });

  it('keeps the newest first and collapses repeats', () => {
    const storage = fakeStorage();
    pushRecent(storage, 'alpha', 100);
    pushRecent(storage, 'beta', 200);
    pushRecent(storage, 'alpha', 300);
    const recent = loadRecent(storage);
    expect(recent.map((entry) => entry.query)).toEqual(['alpha', 'beta']);
    expect(recent[0].at).toBe(300);
  });

  it('ignores an empty query', () => {
    const storage = fakeStorage();
    expect(pushRecent(storage, '   ')).toEqual([]);
    expect(loadRecent(storage)).toEqual([]);
  });

  it('ignores a stored value it cannot validate', () => {
    const storage = fakeStorage();
    storage.setItem('universe.command.recent.v1', JSON.stringify({ not: 'an array' }));
    expect(loadRecent(storage)).toEqual([]);
    storage.setItem('universe.command.recent.v1', '[{"query":5},{"query":"ok","at":1}]');
    expect(loadRecent(storage)).toEqual([{ query: 'ok', at: 1 }]);
  });
});

describe('saved queries', () => {
  it('saves once and refuses a duplicate', () => {
    const storage = fakeStorage();
    expect(saveQuery(storage, 'kind:rune', 5)).toBe(true);
    expect(saveQuery(storage, 'kind:rune', 6)).toBe(false);
    expect(loadSaved(storage)).toEqual([{ query: 'kind:rune', at: 5 }]);
  });

  it('removes exactly the one asked for', () => {
    const storage = fakeStorage();
    saveQuery(storage, 'a', 1);
    saveQuery(storage, 'b', 2);
    removeSaved(storage, 'a');
    expect(loadSaved(storage).map((entry) => entry.query)).toEqual(['b']);
  });
});
