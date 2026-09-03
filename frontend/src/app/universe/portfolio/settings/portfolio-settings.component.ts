/**
 * Portfolio settings: vault passphrase, auto-lock, privacy defaults,
 * encrypted backup export/import with validation-before-replace, and
 * complete local deletion.
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioVaultService } from '../stores/vault.service';

@Component({
  selector: 'app-portfolio-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="settings">
      <h1 i18n="@@universe.portfolio.settings.title">Portfolio settings</h1>

      <section class="panel">
        <h2 i18n="@@universe.portfolio.settings.vault">Encrypted vault</h2>
        @if (store.vaultKind() === 'unlocked') {
          <details>
            <summary i18n="@@universe.portfolio.settings.change-passphrase">Change passphrase</summary>
            <label><span i18n="@@universe.portfolio.settings.new-passphrase">New passphrase</span><input #newPass type="password" autocomplete="new-password" /></label>
            <button type="button" (click)="changePassphrase(newPass.value)" i18n="@@universe.portfolio.settings.change">Change</button>
          </details>
          <div class="row">
            <button type="button" (click)="exportBackup()" i18n="@@universe.portfolio.settings.export">Export encrypted backup (.universe-portfolio)</button>
            @if (downloadUrl(); as url) {
              <a [href]="url" [download]="downloadName()" i18n="@@universe.portfolio.settings.download">Download backup</a>
            }
          </div>
          <div class="row">
            <label>
              <span i18n="@@universe.portfolio.settings.import-file">Import encrypted backup</span>
              <input type="file" accept=".universe-portfolio,.json" (change)="importFile($event)" />
            </label>
            <label><span i18n="@@universe.portfolio.settings.import-passphrase">Backup passphrase</span><input #importPass type="password" /></label>
            <button type="button" (click)="importBackup(importPass.value)" i18n="@@universe.portfolio.settings.import">Validate and import</button>
          </div>
          <details>
            <summary class="danger" i18n="@@universe.portfolio.settings.delete-all">Delete everything stored locally…</summary>
            <p class="soft" i18n="@@universe.portfolio.settings.delete-copy">
              Removes the vault and every local portfolio from this browser profile. Blockchain
              assets are never touched. This cannot be undone without a backup file.
            </p>
            <button type="button" class="danger" (click)="wipe()" i18n="@@universe.portfolio.settings.delete-confirm">Delete all local portfolio data</button>
          </details>
        } @else {
          <p class="soft" i18n="@@universe.portfolio.settings.locked">Unlock the vault to manage settings.</p>
        }
      </section>

      @if (message(); as message) {
        <p class="status" role="status">{{ message }}</p>
      }
    </div>
  `,
  styles: [
    `
      .settings { max-width: 640px; margin: 0 auto; padding: 16px 8px; display: flex; flex-direction: column; gap: 14px; }
      h1 { margin: 0; font-size: 20px; }
      .panel { border: 1px solid var(--u-separator, rgba(0,0,0,0.08)); border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
      h2 { margin: 0; font-size: 15px; }
      details summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; font-size: 13.5px; }
      label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
      input { min-height: 40px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.16)); font: inherit; }
      button { border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); background: transparent; padding: 8px 14px; cursor: pointer; min-height: 44px; }
      button.danger { color: #fff; background: #a02020; border: none; }
      .row { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
      .soft { font-size: 12.5px; color: var(--u-fg-soft, inherit); }
      .danger { color: #a02020; }
      .status { font-size: 13px; color: #1c7c31; }
    `,
  ],
  // ngIf is legacy bootstrap; use @if in templates instead - this component avoids NgIf.
})
export class PortfolioSettingsComponent {
  readonly store = inject(PortfoliosStore);
  private readonly vault = inject(PortfolioVaultService);

  private readonly messageSignal = signal('');
  private readonly downloadUrlSignal = signal('');
  private downloadNameValue = 'portfolio-backup.universe-portfolio';
  private pendingImport: unknown = null;

  readonly message = this.messageSignal.asReadonly();
  readonly downloadUrl = this.downloadUrlSignal.asReadonly();

  protected downloadName(): string {
    return this.downloadNameValue;
  }

  protected async changePassphrase(value: string): Promise<void> {
    if (value.length < 8) {
      this.messageSignal.set($localize`:@@universe.portfolio.settings.passphrase-short:Use at least 8 characters.`);
      return;
    }
    await this.vault.changePassphrase(value);
    this.messageSignal.set($localize`:@@universe.portfolio.settings.passphrase-changed:Passphrase changed; every record was re-encrypted.`);
  }

  protected async exportBackup(): Promise<void> {
    const backup = await this.vault.exportEncrypted();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    this.downloadUrlSignal.set(URL.createObjectURL(blob));
    this.downloadNameValue = `universe-portfolio-${new Date().toISOString().slice(0, 10)}.universe-portfolio`;
    this.messageSignal.set($localize`:@@universe.portfolio.settings.export-ready:Backup ready - download it and store it somewhere safe.`);
  }

  protected importFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined) return;
    void file.text().then((text) => {
      try {
        this.pendingImport = JSON.parse(text);
        this.messageSignal.set($localize`:@@universe.portfolio.settings.import-loaded:Backup file loaded - enter its passphrase to validate and import.`);
      } catch {
        this.messageSignal.set($localize`:@@universe.portfolio.settings.import-bad-file:That file is not a valid backup.`);
      }
    });
  }

  protected async importBackup(passphrase: string): Promise<void> {
    if (this.pendingImport === null) return;
    try {
      const result = await this.vault.importEncrypted(this.pendingImport, passphrase);
      this.pendingImport = null;
      await this.store.reload();
      this.messageSignal.set(
        $localize`:@@universe.portfolio.settings.import-ok:Imported ${result.importedRecords}:count: encrypted record(s); the vault was validated before replacing anything.`,
      );
    } catch (error) {
      this.messageSignal.set(
        error instanceof Error ? error.message : 'The import failed; local data is unchanged.',
      );
    }
  }

  protected async wipe(): Promise<void> {
    await this.vault.wipe();
    await this.store.reload();
    this.messageSignal.set($localize`:@@universe.portfolio.settings.deleted:All local portfolio data was deleted from this browser.`);
  }
}
