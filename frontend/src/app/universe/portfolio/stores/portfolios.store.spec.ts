import { describe, expect, it, vi } from 'vitest';
import { PortfoliosStore } from './portfolios.store';
import { PortfolioVaultService } from './vault.service';
import { emptyPortfolio } from './portfolio-model';
import { Subject } from 'rxjs';

async function fixture(deletePortfolioRecords: (...args: unknown[]) => Promise<void>) {
  const portfolios = [emptyPortfolio('a', 'Delete A', '2026-10-03'), emptyPortfolio('b', 'Keep B', '2026-10-03')];
  const vault = {
    probe: async () => ({ kind: 'unlocked' }),
    isUnlocked: () => true,
    listByType: async () => portfolios.map(value => ({ id: value.id, value })),
    get: async () => ({ activePortfolioId: 'a' }),
    deletePortfolioRecords: vi.fn(deletePortfolioRecords),
  };
  const store = new PortfoliosStore(vault as unknown as PortfolioVaultService);
  await store.initialize();
  return { store, vault };
}

describe('portfolio deletion projection commit', () => {
  it('keeps the prior portfolio and active selection if the atomic vault delete fails', async () => {
    const { store, vault } = await fixture(async () => { throw new Error('controlled transaction abort'); });
    await expect(store.deletePortfolio('a')).rejects.toThrow('controlled transaction abort');
    expect(vault.deletePortfolioRecords).toHaveBeenCalledWith('a', 'b');
    expect(store.portfolios().map(value => value.id)).toEqual(['a', 'b']);
    expect(store.activePortfolioId()).toBe('a');
  });

  it('updates projection and active selection only after committed deletion', async () => {
    let complete!: () => void;
    const committed = new Promise<void>(resolve => { complete = resolve; });
    const { store } = await fixture(() => committed);
    const deleting = store.deletePortfolio('a');
    expect(store.portfolios().map(value => value.id)).toEqual(['a', 'b']);
    expect(store.activePortfolioId()).toBe('a');
    complete();
    await deleting;
    expect(store.portfolios().map(value => value.id)).toEqual(['b']);
    expect(store.activePortfolioId()).toBe('b');
  });
  it('deletes a session-only portfolio without sending an absent record to encrypted storage', async () => {
    const { store, vault } = await fixture(async () => undefined);
    const temporary = await store.createPortfolio('Temporary', { sessionOnly: true });
    expect(store.isSessionOnly(temporary.id)).toBe(true);
    await store.deletePortfolio(temporary.id);
    expect(vault.deletePortfolioRecords).not.toHaveBeenCalled();
    expect(store.portfolios().map(value => value.id)).toEqual(['a', 'b']);
    expect(store.sessionOnlyIds.has(temporary.id)).toBe(false);
  });
});


describe('workspace migration projection', () => {
  const preview = { watched: [], watchedCount: 0, labelCount: 0, groupCount: 0, contentHash: 'empty' };
  it('publishes the complete portfolio only after the atomic vault commit', async () => {
    let finish!: () => void;
    const committed = new Promise<void>(resolve => { finish = resolve; });
    const vault = { isUnlocked: () => true, commitWorkspaceMigration: vi.fn(async () => { await committed; return true; }) };
    const store = new PortfoliosStore(vault as unknown as PortfolioVaultService);
    const migrating = store.migrateWorkspace('Migrated', preview);
    expect(store.portfolios()).toEqual([]);
    expect(store.migrated()).toBe(false);
    finish(); await migrating;
    expect(store.portfolios()).toHaveLength(1);
    expect(store.activePortfolio()?.name).toBe('Migrated');
    expect(store.migrated()).toBe(true);
  });
  it('keeps the projection empty after a failed migration commit', async () => {
    const vault = { commitWorkspaceMigration: async () => { throw new Error('storage aborted'); } };
    const store = new PortfoliosStore(vault as unknown as PortfolioVaultService);
    await expect(store.migrateWorkspace('Migrated', preview)).rejects.toThrow('storage aborted');
    expect(store.portfolios()).toEqual([]);
    expect(store.activePortfolioId()).toBeNull();
    expect(store.migrated()).toBe(false);
  });
  it('does not repopulate private signals when the vault locks after commit', async () => {
    const vault = { isUnlocked: () => false, commitWorkspaceMigration: async () => true };
    const store = new PortfoliosStore(vault as unknown as PortfolioVaultService);
    await expect(store.migrateWorkspace('Migrated', preview)).rejects.toThrow('locked');
    expect(store.portfolios()).toEqual([]);
    expect(store.migrated()).toBe(false);
  });
});


describe('locked reload projection', () => {
  it('does not expose decrypted portfolios when a later read fails after locking', async () => {
    const vault = {
      listByType: async () => [{ id: 'private', value: emptyPortfolio('private', 'Private', '2026-10-03') }],
      get: async () => { throw new Error('locked during preferences read'); },
      isUnlocked: () => false,
    };
    const store = new PortfoliosStore(vault as unknown as PortfolioVaultService);
    await expect(store.reload()).rejects.toThrow('locked');
    expect(store.portfolios()).toEqual([]);
    expect(store.activePortfolioId()).toBeNull();
  });
  it('checks unlock state after all reads before publishing the projection', async () => {
    const vault = {
      listByType: async () => [{ id: 'private', value: emptyPortfolio('private', 'Private', '2026-10-03') }],
      get: async () => null,
      isUnlocked: () => false,
    };
    const store = new PortfoliosStore(vault as unknown as PortfolioVaultService);
    await expect(store.reload()).rejects.toThrow('locked');
    expect(store.portfolios()).toEqual([]);
    expect(store.migrated()).toBe(false);
  });
});

describe('late writes after a vault lock', () => {
  it('does not republish a newly committed private portfolio after locking', async () => {
    let finish!: () => void;
    const writing = new Promise<void>(resolve => {finish = resolve;});
    const {store, vault} = await fixture(async () => undefined);
    Object.assign(vault, {put: vi.fn(() => writing), lock: vi.fn()});
    const creating = store.createPortfolio('Private pending name');
    store.lock(); finish();
    await expect(creating).rejects.toThrow('locked');
    expect(store.portfolios()).toEqual([]); expect(store.activePortfolioId()).toBeNull();
  });
  it('withdraws projected private data on an underlying auto/visibility lock notification', async () => {
    const locks = new Subject<void>();
    const portfolios = [emptyPortfolio('private', 'Sensitive', '2026-10-04')];
    const vault = {locked$: locks, isUnlocked: () => true, probe: async () => ({kind:'unlocked'}), listByType: async () => portfolios.map(value => ({value})), get: async () => null};
    const store = new PortfoliosStore(vault as unknown as PortfolioVaultService);
    await store.initialize(); expect(store.portfolios()).toHaveLength(1);
    locks.next(); expect(store.portfolios()).toEqual([]); expect(store.activePortfolioId()).toBeNull(); expect(store.vaultKind()).toBe('locked');
  });
  it('rejects an old reload even if the vault has unlocked again before its last read resolves', async () => {
    let finish!: () => void;
    const waiting = new Promise<null>(resolve => {finish = () => resolve(null);});
    const {store, vault} = await fixture(async () => undefined);
    Object.assign(vault, {get: vi.fn().mockResolvedValueOnce(null).mockReturnValueOnce(waiting), lock: vi.fn()});
    const reloading = store.reload();
    await Promise.resolve(); await Promise.resolve();
    store.lock(); finish();
    await expect(reloading).rejects.toThrow('locked');
    expect(store.portfolios()).toEqual([]);
  });
  it('does not overwrite a fresh unlocked projection with a late prior-session update', async () => {
    let finish!: () => void;
    const writing = new Promise<void>(resolve => {finish = resolve;});
    const {store, vault} = await fixture(async () => undefined);
    Object.assign(vault, {put: vi.fn(() => writing), lock: vi.fn()});
    const updating = store.updatePortfolio('a', portfolio => ({...portfolio, name:'Old pending update'}));
    store.lock(); await store.initialize();
    expect(store.activePortfolio()?.name).toBe('Delete A');
    finish(); await expect(updating).rejects.toThrow('locked');
    expect(store.activePortfolio()?.name).toBe('Delete A');
  });
});
