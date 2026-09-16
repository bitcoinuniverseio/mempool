import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { MAX_VPACK_BYTES, MAX_VPACK_ENVELOPE_BYTES, openVpack, sealVpack, validateBackupPackage } from './ark-backup-crypto';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-ark-backups',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Encrypted Portable V-PACK Backups</h1>
        <p class="text-muted">Encrypt and restore VTXO package files locally. Package contents and passphrases stay in this browser.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/ark/vpack' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/ark/vpack/verify' | relativeUrl">Verify Anchor</a>
          <a class="nav-link" [routerLink]="'/ark/vpack/translate' | relativeUrl">Translate Dialect</a>
          <a class="nav-link active" [routerLink]="'/ark/backups' | relativeUrl">Encrypted Backups</a>
          <a class="nav-link" [routerLink]="'/ark/exit' | relativeUrl">Unilateral Exit</a>
          <a class="nav-link" [routerLink]="'/ark/exit/simulate' | relativeUrl">Exit Simulator</a>
          <a class="nav-link" [routerLink]="'/ark/providers' | relativeUrl">ASP Registry</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Backup Envelope Encryption</h5>
        <p class="small text-muted">Supports MVV version 1 JSON, directly or inside a minimal_viable_vtxo field. Restoring a backup checks its authenticated contents and package structure; verify anchors separately before relying on chain state.</p>
        <div *ngIf="error" class="alert alert-danger" role="alert">{{ error }}</div>
        <div *ngIf="status" class="alert alert-success" role="status">{{ status }}</div>
        <div class="row g-3">
          <div class="col-md-6">
            <div class="p-3 border rounded bg-body">
              <h6>Export Encrypted Package</h6>
              <label for="ark-package-file" class="form-label small">Load package JSON (up to 1 MiB)</label>
              <input id="ark-package-file" type="file" accept=".json,application/json" class="form-control mb-2" [disabled]="busy" (change)="loadFile($event, 'package')">
              <label for="ark-package-json" class="form-label small">Package JSON</label>
              <textarea id="ark-package-json" class="form-control font-monospace mb-2" rows="8" [(ngModel)]="packageText" (ngModelChange)="resetStatus()" [disabled]="busy" autocomplete="off" spellcheck="false"></textarea>
              <label for="ark-backup-passphrase" class="form-label small">Passphrase (at least 12 characters)</label>
              <input id="ark-backup-passphrase" type="password" class="form-control mb-2" [(ngModel)]="passphrase" (ngModelChange)="resetStatus()" [disabled]="busy" autocomplete="new-password">
              <label for="ark-backup-confirm" class="form-label small">Confirm passphrase for export</label>
              <input id="ark-backup-confirm" type="password" class="form-control mb-3" [(ngModel)]="confirmation" (ngModelChange)="resetStatus()" [disabled]="busy" autocomplete="new-password">
              <button class="btn btn-outline-primary btn-sm" (click)="exportBackup()" [disabled]="busy || !packageText || !passphrase || !confirmation">Export Encrypted V-PACK</button>
            </div>
          </div>
          <div class="col-md-6">
            <div class="p-3 border rounded bg-body">
              <h6>Import & Decrypt Package</h6>
              <p class="small text-muted mb-3">Load the sealed backup and enter its passphrase above. The package is restored only after authentication and validation succeed.</p>
              <label for="ark-envelope-file" class="form-label small">Load encrypted backup</label>
              <input id="ark-envelope-file" type="file" accept=".json,application/json" class="form-control mb-2" [disabled]="busy" (change)="loadFile($event, 'envelope')">
              <label for="ark-envelope-json" class="form-label small">Sealed envelope JSON</label>
              <textarea id="ark-envelope-json" class="form-control font-monospace mb-3" rows="8" [(ngModel)]="envelopeText" (ngModelChange)="resetStatus()" [disabled]="busy" autocomplete="off" spellcheck="false"></textarea>
              <button class="btn btn-outline-secondary btn-sm" (click)="importBackup()" [disabled]="busy || !envelopeText || !passphrase">Import Sealed Envelope</button>
            </div>
          </div>
          <div class="col-12 d-flex gap-2 align-items-center">
            <button class="btn btn-outline-secondary btn-sm" (click)="clearWorkspace()" [disabled]="busy">Clear Workspace</button>
            <span *ngIf="busy" role="status">{{ busy === 'export' ? 'Encrypting package…' : busy === 'import' ? 'Authenticating backup…' : 'Reading local file…' }}</span>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ArkBackupsComponent implements OnDestroy {
  packageText = '';
  envelopeText = '';
  passphrase = '';
  confirmation = '';
  busy: 'export' | 'import' | 'file' | null = null;
  error: string | null = null;
  status: string | null = null;
  private generation = 0;
  private networkSubscription: Subscription;

  constructor(private state: StateService, private cdr: ChangeDetectorRef) {
    this.networkSubscription = this.state.networkChanged$.subscribe(() => {
      this.clearWorkspace();
      this.cdr.markForCheck();
    });
  }

  resetStatus(): void { this.error = null; this.status = null; }

  clearWorkspace(): void {
    this.generation++;
    this.packageText = ''; this.envelopeText = ''; this.passphrase = ''; this.confirmation = '';
    this.busy = null;
    this.resetStatus();
  }

  async loadFile(event: Event, kind: 'package' | 'envelope'): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.busy) return;
    this.resetStatus();
    const generation = ++this.generation;
    this.busy = 'file';
    try {
      if (file.size > (kind === 'package' ? MAX_VPACK_BYTES : MAX_VPACK_ENVELOPE_BYTES)) throw new Error('The selected file exceeds the size limit.');
      const text = await file.text();
      if (generation !== this.generation) return;
      if (kind === 'package') {
        validateBackupPackage(text, this.state.network);
        this.packageText = text;
      } else { this.envelopeText = text; }
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : 'The local file could not be read.';
    } finally {
      if (generation === this.generation) { this.busy = null; this.cdr.markForCheck(); }
    }
  }

  async exportBackup(): Promise<void> {
    if (this.busy) return;
    this.resetStatus();
    if (this.passphrase !== this.confirmation) { this.error = 'The export passphrases do not match.'; return; }
    const generation = ++this.generation;
    this.busy = 'export';
    try {
      const envelope = await sealVpack(this.packageText, this.passphrase, this.state.network);
      if (generation !== this.generation) return;
      const url = URL.createObjectURL(new Blob([envelope], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'vpack-encrypted-backup.json';
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
      this.status = 'Encrypted backup created. Download requested.';
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : 'The backup could not be encrypted.';
    } finally {
      if (generation === this.generation) { this.passphrase = ''; this.confirmation = ''; this.busy = null; this.cdr.markForCheck(); }
    }
  }

  async importBackup(): Promise<void> {
    if (this.busy) return;
    this.resetStatus();
    const generation = ++this.generation;
    this.busy = 'import';
    try {
      const text = await openVpack(this.envelopeText, this.passphrase, this.state.network);
      if (generation !== this.generation) return;
      this.packageText = text;
      this.status = 'Authenticated package restored in this workspace.';
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : 'The backup could not be authenticated.';
    } finally {
      if (generation === this.generation) { this.passphrase = ''; this.confirmation = ''; this.busy = null; this.cdr.markForCheck(); }
    }
  }

  ngOnDestroy(): void { this.networkSubscription.unsubscribe(); this.clearWorkspace(); }
}
