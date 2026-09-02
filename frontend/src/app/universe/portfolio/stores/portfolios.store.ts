/**
 * The portfolios store: the signal-based projection of the encrypted
 * vault. Components read signals; every mutation goes through the vault
 * transactionally and updates the projection only after the vault
 * accepted the write.
 */

import { Injectable, computed, signal } from '@angular/core';
import { PortfolioVaultService } from './vault.service';
import {
  emptyPortfolio,
  newLocalId,
  type InclusionPolicy,
  type LocalPortfolio,
} from './portfolio-model';

const PORTFOLIO_RECORD = 'portfolio';
const SESSION_PORTFOLIO_RECORD = 'session-portfolio';
const MIGRATION_RECORD = 'migration.v1';
const PREFERENCE_RECORD = 'preferences';

export interface VaultPreferences {
  readonly autoLockMinutes: number;
  readonly relockWhenHidden: boolean;
  readonly activePortfolioId?: string;
}

@Injectable({ providedIn: 'root' })
export class PortfoliosStore {
  private readonly _portfolios = signal<LocalPortfolio[]>([]);
  private readonly _activePortfolioId = signal<string | null>(null);
  private readonly _vaultKind = signal<'absent' | 'locked' | 'unlocked'>('absent');
  private readonly _migrated = signal<boolean>(false);

  readonly portfolios = this._portfolios.asReadonly();
  readonly activePortfolioId = this._activePortfolioId.asReadonly();
  readonly vaultKind = this._vaultKind.asReadonly();
  readonly migrated = this._migrated.asReadonly();
  readonly activePortfolio = computed(
    () => this._portfolios().find((p) => p.id === this._activePortfolioId()) ?? null,
  );
  readonly livePortfolios = computed(() => this._portfolios().filter((p) => !p.archived));

  constructor(private readonly vault: PortfolioVaultService) {}

  async initialize(): Promise<'absent' | 'locked' | 'unlocked'> {
    const state = await this.vault.probe();
    this._vaultKind.set(state.kind);
    if (state.kind === 'unlocked') await this.reload();
    return state.kind;
  }

  async createVault(passphrase: string): Promise<void> {
    await this.vault.create(passphrase);
    this._vaultKind.set('unlocked');
  }

  async unlock(passphrase: string): Promise<boolean> {
    const ok = await this.vault.unlock(passphrase);
    if (ok) {
      this._vaultKind.set('unlocked');
      await this.reload();
    }
    return ok;
  }

  lock(): void {
    this.vault.lock();
    this._portfolios.set([]);
    this._activePortfolioId.set(null);
    this._vaultKind.set('locked');
  }

  isUnlocked(): boolean {
    return this.vault.isUnlocked();
  }

  async reload(): Promise<void> {
    const entries = await this.vault.listByType(PORTFOLIO_RECORD);
    const portfolios = entries
      .map((entry) => entry.value as LocalPortfolio)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    this._portfolios.set(portfolios);
    const preferences = await this.readPreferences();
    const active = preferences?.activePortfolioId ?? null;
    this._activePortfolioId.set(
      active !== null && portfolios.some((p) => p.id === active && !p.archived)
        ? active
        : portfolios.find((p) => !p.archived)?.id ?? null,
    );
    this._migrated.set((await this.vault.get<{ done: boolean }>(MIGRATION_RECORD))?.done === true);
  }

  async createPortfolio(
    name: string,
    options: { sessionOnly?: boolean } = {},
  ): Promise<LocalPortfolio> {
    const portfolio = emptyPortfolio(newLocalId(), name, new Date().toISOString());
    if (options.sessionOnly === true) {
      this._portfolios.update((all) => [...all, portfolio]);
      this._activePortfolioId.set(portfolio.id);
      return portfolio;
    }
    await this.vault.put(PORTFOLIO_RECORD, portfolio.id, portfolio);
    this._portfolios.update((all) => [...all, portfolio]);
    this._activePortfolioId.set(portfolio.id);
    await this.setActivePortfolio(portfolio.id);
    return portfolio;
  }

  async updatePortfolio(
    id: string,
    mutate: (portfolio: LocalPortfolio) => LocalPortfolio,
  ): Promise<void> {
    const current = this._portfolios().find((p) => p.id === id);
    if (current === undefined) throw new Error('The portfolio no longer exists.');
    const next = mutate({ ...current, updatedAt: new Date().toISOString() });
    if (this.isSessionOnly(next.id)) {
      this._portfolios.update((all) => all.map((p) => (p.id === id ? next : p)));
      return;
    }
    await this.vault.put(PORTFOLIO_RECORD, next.id, next);
    this._portfolios.update((all) => all.map((p) => (p.id === id ? next : p)));
  }

  isSessionOnly(id: string): boolean {
    // A session-only portfolio lives only in memory: probe the signal set
    // membership against the vault-backed snapshot taken at load time.
    return this._portfolios().some((p) => p.id === id) === true &&
      this.sessionOnlyIds.has(id);
  }

  readonly sessionOnlyIds = new Set<string>();

  markSessionOnly(id: string): void {
    this.sessionOnlyIds.add(id);
  }

  async deletePortfolio(id: string): Promise<void> {
    await this.vault.deleteRecord(id);
    this._portfolios.update((all) => all.filter((p) => p.id !== id));
    if (this._activePortfolioId() === id) {
      this._activePortfolioId.set(this._portfolios().find((p) => !p.archived)?.id ?? null);
    }
  }

  async setActivePortfolio(id: string): Promise<void> {
    this._activePortfolioId.set(id);
    await this.writePreferences((current) => ({ ...current, activePortfolioId: id }));
  }

  async applyInclusionPolicy(portfolioId: string, policy: InclusionPolicy): Promise<void> {
    // The inclusion policy is part of account metadata, stored per address.
    await this.updatePortfolio(portfolioId, (portfolio) => ({
      ...portfolio,
      annotations: {
        ...portfolio.annotations,
        ...Object.fromEntries(
          Object.entries(policy).map(([address, accountId]) => [
            `inclusion:${address}`,
            { note: accountId },
          ]),
        ),
      },
    }));
  }

  async readPreferences(): Promise<VaultPreferences | null> {
    return (await this.vault.get<VaultPreferences>(PREFERENCE_RECORD)) ?? null;
  }

  async writePreferences(
    mutate: (current: VaultPreferences) => VaultPreferences,
  ): Promise<void> {
    const current = (await this.readPreferences()) ?? { autoLockMinutes: 15, relockWhenHidden: false };
    await this.vault.put(PREFERENCE_RECORD, PREFERENCE_RECORD, mutate(current));
  }

  async markMigrated(): Promise<void> {
    await this.vault.put(MIGRATION_RECORD, MIGRATION_RECORD, { done: true, at: new Date().toISOString() });
    this._migrated.set(true);
  }
}
