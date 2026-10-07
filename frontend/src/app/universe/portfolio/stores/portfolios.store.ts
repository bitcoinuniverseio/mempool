/**
 * The portfolios store: the signal-based projection of the encrypted
 * vault. Components read signals; every mutation goes through the vault
 * transactionally and updates the projection only after the vault
 * accepted the write.
 */

import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { PortfolioVaultService } from './vault.service';
import { buildMigratedPortfolio, type MigrationPreview } from '../shared/migration';
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
export class PortfoliosStore implements OnDestroy {
  private projectionVersion = 0;
  private readonly lockSubscription?: Subscription;
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

  constructor(private readonly vault: PortfolioVaultService) {
    this.lockSubscription = this.vault.locked$?.subscribe(() => this.clearLockedProjection());
  }

  ngOnDestroy(): void {this.lockSubscription?.unsubscribe(); this.clearLockedProjection();}
  private clearLockedProjection(): void {
    this.projectionVersion++;
    this._portfolios.set([]);
    this._activePortfolioId.set(null);
    this._vaultKind.set('locked');
    this._migrated.set(false);
    this.sessionOnlyIds.clear();
  }
  private assertCurrentProjection(version: number): void {
    if (version !== this.projectionVersion || !this.vault.isUnlocked()) throw new Error('The vault was locked while updating portfolios.');
  }

  async initialize(): Promise<'absent' | 'locked' | 'unlocked'> {
    const version = this.projectionVersion;
    const state = await this.vault.probe();
    if (version !== this.projectionVersion) throw new Error('The vault was locked during initialization.');
    this._vaultKind.set(state.kind);
    if (state.kind === 'unlocked') await this.reload();
    return state.kind;
  }

  async createVault(passphrase: string): Promise<void> {
    const version = this.projectionVersion;
    await this.vault.create(passphrase);
    this.assertCurrentProjection(version);
    this._vaultKind.set('unlocked');
  }

  async unlock(passphrase: string): Promise<boolean> {
    const version = this.projectionVersion;
    const ok = await this.vault.unlock(passphrase);
    if (ok) {
      this.assertCurrentProjection(version);
      this._vaultKind.set('unlocked');
      await this.reload();
    }
    return ok;
  }

  lock(): void {
    const version = this.projectionVersion;
    this.vault.lock();
    if (version === this.projectionVersion) this.clearLockedProjection();
  }

  isUnlocked(): boolean {
    return this.vault.isUnlocked();
  }

  async reload(): Promise<void> {
    const version = this.projectionVersion;
    const entries = await this.vault.listByType(PORTFOLIO_RECORD);
    const portfolios = entries
      .map((entry) => entry.value as LocalPortfolio)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const preferences = await this.readPreferences();
    const migrated = (await this.vault.get<{ done: boolean }>(MIGRATION_RECORD))?.done === true;
    this.assertCurrentProjection(version);
    this._portfolios.set(portfolios);
    const active = preferences?.activePortfolioId ?? null;
    this._activePortfolioId.set(
      active !== null && portfolios.some((p) => p.id === active && !p.archived)
        ? active
        : portfolios.find((p) => !p.archived)?.id ?? null,
    );
    this._migrated.set(migrated);
  }

  async createPortfolio(
    name: string,
    options: { sessionOnly?: boolean } = {},
  ): Promise<LocalPortfolio> {
    const version = this.projectionVersion;
    const portfolio = emptyPortfolio(newLocalId(), name, new Date().toISOString());
    if (options.sessionOnly === true) {
      this.sessionOnlyIds.add(portfolio.id);
      this._portfolios.update((all) => [...all, portfolio]);
      this._activePortfolioId.set(portfolio.id);
      return portfolio;
    }
    await this.vault.put(PORTFOLIO_RECORD, portfolio.id, portfolio);
    this.assertCurrentProjection(version);
    this._portfolios.update((all) => [...all, portfolio]);
    this._activePortfolioId.set(portfolio.id);
    await this.setActivePortfolio(portfolio.id);
    return portfolio;
  }

  async updatePortfolio(
    id: string,
    mutate: (portfolio: LocalPortfolio) => LocalPortfolio,
  ): Promise<void> {
    const version = this.projectionVersion;
    const current = this._portfolios().find((p) => p.id === id);
    if (current === undefined) throw new Error('The portfolio no longer exists.');
    const next = mutate({ ...current, updatedAt: new Date().toISOString() });
    if (this.isSessionOnly(next.id)) {
      this._portfolios.update((all) => all.map((p) => (p.id === id ? next : p)));
      return;
    }
    await this.vault.put(PORTFOLIO_RECORD, next.id, next);
    this.assertCurrentProjection(version);
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
    const version = this.projectionVersion;
    if (!this._portfolios().some(portfolio => portfolio.id === id)) {
      throw new Error('The portfolio no longer exists.');
    }
    const replacement = this._portfolios().find(portfolio => portfolio.id !== id && !portfolio.archived)?.id ?? null;
    if (this.isSessionOnly(id)) { this.sessionOnlyIds.delete(id); }
    else { await this.vault.deletePortfolioRecords(id, replacement); this.assertCurrentProjection(version); }
    this._portfolios.update((all) => all.filter((p) => p.id !== id));
    if (this._activePortfolioId() === id) {
      this._activePortfolioId.set(replacement);
    }
  }

  async setActivePortfolio(id: string): Promise<void> {
    if (this.selectPortfolio(id) === null) throw new Error('The portfolio no longer exists.');
    await this.writePreferences((current) => ({ ...current, activePortfolioId: id }));
  }

  /** A route may select only an existing local portfolio, without changing vault preferences. */
  selectPortfolio(id: string): LocalPortfolio | null {
    const portfolio = this.livePortfolios().find((entry) => entry.id === id) ?? null;
    this._activePortfolioId.set(portfolio?.id ?? null);
    return portfolio;
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
    const version = this.projectionVersion;
    const current = (await this.readPreferences()) ?? { autoLockMinutes: 15, relockWhenHidden: false };
    this.assertCurrentProjection(version);
    await this.vault.put(PREFERENCE_RECORD, PREFERENCE_RECORD, mutate(current));
  }

  async migrateWorkspace(name: string, preview: MigrationPreview): Promise<void> {
    const version = this.projectionVersion;
    const portfolio = buildMigratedPortfolio(emptyPortfolio(newLocalId(), name, new Date().toISOString()), preview);
    const committed = await this.vault.commitWorkspaceMigration(portfolio, preview.contentHash);
    this.assertCurrentProjection(version);
    if (!committed) { await this.reload(); return; }
    this._portfolios.update(all => [...all, portfolio]);
    this._activePortfolioId.set(portfolio.id);
    this._migrated.set(true);
  }

  async markMigrated(): Promise<void> {
    const version = this.projectionVersion;
    await this.vault.put(MIGRATION_RECORD, MIGRATION_RECORD, { done: true, at: new Date().toISOString() });
    this.assertCurrentProjection(version);
    this._migrated.set(true);
  }
}
