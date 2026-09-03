/**
 * Manage portfolios: create, rename, duplicate settings, archive, restore,
 * delete with an explicit explanation, switch, set default.
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PortfoliosStore } from '../stores/portfolios.store';
import { findDuplicateAddresses } from '../stores/portfolio-model';

@Component({
  selector: 'app-manage-portfolios',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="manage">
      <header class="head">
        <h1 i18n="@@universe.portfolio.manage.title">Manage portfolios</h1>
        <a class="primary" routerLink="/portfolio/new" i18n="@@universe.portfolio.manage.new">New portfolio</a>
      </header>

      @if (store.vaultKind() !== 'unlocked') {
        <p class="soft" i18n="@@universe.portfolio.manage.locked">
          The vault is locked. Unlock from the portfolio home to manage stored portfolios.
        </p>
      }

      <ul class="list">
        @for (portfolio of store.portfolios(); track portfolio.id) {
          <li>
            <div class="row">
              <div class="info">
                @if (renaming() === portfolio.id) {
                  <input #renameInput type="text" [value]="portfolio.name" (keydown.enter)="confirmRename(portfolio.id, renameInput.value)" />
                  <button type="button" (click)="confirmRename(portfolio.id, renameInput.value)" i18n="@@universe.portfolio.manage.save">Save</button>
                } @else {
                  <strong>{{ portfolio.name }}</strong>
                  <span class="meta">
                    {{ portfolio.accounts.length }} account(s)
                    @if (portfolio.archived) { · <span i18n="@@universe.portfolio.manage.archived">archived</span> }
                  </span>
                }
              </div>
              <div class="actions">
                @if (!portfolio.archived) {
                  <a [routerLink]="['/portfolio/p', portfolio.id, 'overview']" i18n="@@universe.portfolio.manage.open">Open</a>
                }
                <button type="button" (click)="renaming.set(portfolio.id)" i18n="@@universe.portfolio.manage.rename">Rename</button>
                <button type="button" (click)="duplicate(portfolio)" i18n="@@universe.portfolio.manage.duplicate">Duplicate</button>
                <button type="button" (click)="toggleArchive(portfolio)">
                  {{ portfolio.archived ? restoreLabel() : archiveLabel() }}
                </button>
                <button type="button" class="danger" (click)="confirmDelete(portfolio.id)" i18n="@@universe.portfolio.manage.delete">Delete…</button>
              </div>
            </div>
            @if (findDuplicateAddresses(portfolio).length > 0) {
              <p class="warning" role="note" i18n="@@universe.portfolio.manage.duplicates">
                Some addresses appear under more than one account - aggregation counts them once.
              </p>
            }
          </li>
        }
      </ul>

      @if (deleting(); as id) {
        <div class="dialog" role="alertdialog" aria-labelledby="delete-title">
          <div class="dialog-panel">
            <h2 id="delete-title" i18n="@@universe.portfolio.manage.delete-title">Delete this portfolio?</h2>
            <p i18n="@@universe.portfolio.manage.delete-copy">
              This removes the local portfolio definition, its accounts, labels, views, and
              snapshots from the encrypted vault on this device. Your blockchain assets are
              untouched - this deletes only what this browser stored.
            </p>
            <div class="actions">
              <button type="button" class="danger" (click)="confirmDeleteStep2()" i18n="@@universe.portfolio.manage.delete-confirm">Delete local data</button>
              <button type="button" (click)="deleting.set('')" i18n="@@universe.portfolio.manage.cancel">Cancel</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .manage { max-width: 760px; margin: 0 auto; padding: 16px 8px; display: flex; flex-direction: column; gap: 14px; }
      .head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      h1 { margin: 0; font-size: 20px; }
      a.primary { background: var(--u-brand, #c40059); color: #fff; text-decoration: none; padding: 8px 14px; border-radius: 8px; font-weight: 600; min-height: 44px; display: inline-flex; align-items: center; }
      .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .row { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; border: 1px solid var(--u-separator, rgba(0,0,0,0.08)); border-radius: 12px; padding: 12px 14px; }
      .info strong { font-size: 14.5px; }
      .meta { display: block; font-size: 12.5px; color: var(--u-fg-soft, inherit); }
      .actions { display: flex; gap: 6px; flex-wrap: wrap; }
      .actions a, .actions button { min-height: 36px; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.12)); background: transparent; cursor: pointer; font-size: 12.5px; display: inline-flex; align-items: center; }
      .actions a { text-decoration: none; }
      .actions .danger { color: #a02020; }
      input { min-height: 40px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.16)); font: inherit; }
      .warning { font-size: 12.5px; color: #8a6100; margin: 6px 4px 0; }
      .dialog { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
      .dialog-panel { background: var(--u-surface, #fff); border-radius: 14px; padding: 22px; max-width: 460px; }
      .dialog h2 { margin: 0 0 8px; font-size: 16px; }
      .actions { display: flex; gap: 10px; margin-top: 14px; }
      .actions button { border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); background: transparent; padding: 8px 14px; cursor: pointer; min-height: 44px; }
      .actions .danger { color: #fff; background: #a02020; border: none; }
      .soft { color: var(--u-fg-soft, inherit); font-size: 13px; }
    `,
  ],
})
export class ManagePortfoliosComponent {
  readonly store = inject(PortfoliosStore);
  private readonly router = inject(Router);

  readonly renaming = signal('');
  readonly deleting = signal('');

  protected findDuplicateAddresses = findDuplicateAddresses;

  protected archiveLabel(): string {
    return $localize`:@@universe.portfolio.manage.archive:Archive`;
  }

  protected restoreLabel(): string {
    return $localize`:@@universe.portfolio.manage.restore:Restore`;
  }

  protected async confirmRename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    await this.store.updatePortfolio(id, (portfolio) => ({ ...portfolio, name: trimmed }));
    this.renaming.set('');
  }

  protected async duplicate(portfolio: { id: string; name: string }): Promise<void> {
    const source = this.store.portfolios().find((candidate) => candidate.id === portfolio.id);
    if (source === undefined) return;
    // Duplicate settings only - no account data unless the user selects it later.
    const copy = await this.store.createPortfolio(`${source.name} - copy`);
    await this.store.updatePortfolio(copy.id, (current) => ({
      ...current,
      groups: source.groups,
      tags: source.tags,
      quoteCurrency: source.quoteCurrency,
      privacy: source.privacy,
      snapshotPolicy: source.snapshotPolicy,
    }));
  }

  protected async toggleArchive(portfolio: { id: string; archived: boolean }): Promise<void> {
    await this.store.updatePortfolio(portfolio.id, (current) => ({
      ...current,
      archived: !current.archived,
    }));
  }

  protected confirmDelete(id: string): void {
    this.deleting.set(id);
  }

  protected async confirmDeleteStep2(): Promise<void> {
    const id = this.deleting();
    this.deleting.set('');
    await this.store.deletePortfolio(id);
    void this.router.navigate(['/portfolio']);
  }
}
