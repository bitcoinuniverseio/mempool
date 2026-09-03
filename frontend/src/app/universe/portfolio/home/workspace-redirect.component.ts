/**
 * /portfolio/workspace compatibility route: runs the local-data migration
 * from the old plaintext watchlist and redirects to the right view.
 */

import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PortfoliosStore } from '../stores/portfolios.store';
import {
  buildMigratedPortfolio,
  migrateWorkspace,
  type MigrationPreview,
} from '../shared/migration';

@Component({
  selector: 'app-workspace-redirect',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" role="status">
      @if (store.migrated()) {
        <p i18n="@@universe.portfolio.workspace.already">Migration already completed - opening…</p>
      } @else if (preview(); as preview) {
        <section class="panel">
          <h1 i18n="@@universe.portfolio.workspace.title">Bring your watchlist into the vault</h1>
          <p i18n="@@universe.portfolio.workspace.copy">
            The old plaintext watchlist moves into the encrypted portfolio vault. Nothing is lost;
            the old records stay until the new vault has been reopened successfully.
          </p>
          <ul>
            <li i18n="@@universe.portfolio.workspace.addresses">
              {{ preview.watchedCount }} watched address{{ preview.watchedCount === 1 ? '' : 'es' }}
            </li>
            <li i18n="@@universe.portfolio.workspace.labels">{{ preview.labelCount }} label{{ preview.labelCount === 1 ? '' : 's' }}</li>
            <li i18n="@@universe.portfolio.workspace.groups">{{ preview.groupCount }} group{{ preview.groupCount === 1 ? '' : 's' }}</li>
          </ul>
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          <div class="actions">
            <button type="button" class="primary" (click)="run()" i18n="@@universe.portfolio.workspace.migrate">Migrate now</button>
            <button type="button" (click)="skip()" i18n="@@universe.portfolio.workspace.skip">Skip for now</button>
          </div>
        </section>
      } @else {
        <p i18n="@@universe.portfolio.workspace.locked">Unlock the vault to run the migration.</p>
      }
    </div>
  `,
  styles: [
    `
      .wrap { display: flex; justify-content: center; padding: 8vh 8px 8px; }
      .panel { max-width: 480px; width: 100%; padding: 28px; border-radius: 14px; border: 1px solid var(--u-separator, rgba(0,0,0,0.08)); }
      .actions { display: flex; gap: 10px; margin-top: 16px; }
      button { min-height: 44px; padding: 10px 16px; border-radius: 9px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); background: transparent; cursor: pointer; }
      button.primary { background: var(--u-brand, #c40059); color: #fff; border: none; font-weight: 600; }
      .error { color: #a02020; font-size: 13px; }
    `,
  ],
})
export class WorkspaceRedirectComponent implements OnInit {
  readonly store = inject(PortfoliosStore);
  private readonly router = inject(Router);
  private readonly previewSignal = signal<MigrationPreview | null>(null);
  private readonly errorSignal = signal('');

  ngOnInit(): void {
    if (this.store.migrated()) {
      this.redirect();
      return;
    }
    if (!this.store.isUnlocked()) {
      return; // Template explains: unlock first.
    }
    this.previewSignal.set(migrateWorkspace());
  }

  protected preview(): MigrationPreview | null {
    return this.previewSignal();
  }

  protected error(): string {
    return this.errorSignal();
  }

  protected async run(): Promise<void> {
    try {
      const name = $localize`:@@universe.portfolio.workspace.default-name:Migrated watchlist`;
      const portfolio = await this.store.createPortfolio(name);
      const migrated = buildMigratedPortfolio(portfolio, migrateWorkspace());
      await this.store.updatePortfolio(portfolio.id, () => migrated);
      await this.store.markMigrated();
      this.redirect();
    } catch (error) {
      this.errorSignal.set(
        error instanceof Error ? error.message : 'The migration could not complete; nothing was changed.',
      );
    }
  }

  protected skip(): void {
    this.redirect();
  }

  private redirect(): void {
    const active = this.store.activePortfolio();
    void this.router.navigate(
      active !== null ? ['/portfolio/p', active.id, 'overview'] : ['/portfolio/new'],
    );
  }
}
