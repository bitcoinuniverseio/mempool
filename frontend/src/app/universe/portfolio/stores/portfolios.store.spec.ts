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
