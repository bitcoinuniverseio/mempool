import { describe, expect, it, vi } from 'vitest';
import { PortfoliosStore } from './portfolios.store';
import { PortfolioVaultService } from './vault.service';
import { emptyPortfolio } from './portfolio-model';

async function fixture(deletePortfolioRecords: (...args: unknown[]) => Promise<void>) {
  const portfolios = [emptyPortfolio('a', 'Delete A', '2026-10-03'), emptyPortfolio('b', 'Keep B', '2026-10-03')];
  const vault = {
    probe: async () => ({ kind: 'unlocked' }),
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
