import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-ark-backups',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Encrypted Portable V-PACK Backups</h1>
        <p class="text-muted">Export and restore client-side encrypted VTXO package envelopes with zero plaintext leakage.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/ark/vpack">Overview</a>
          <a class="nav-link" routerLink="/ark/vpack/verify">Verify Anchor</a>
          <a class="nav-link" routerLink="/ark/vpack/translate">Translate Dialect</a>
          <a class="nav-link active" routerLink="/ark/backups">Encrypted Backups</a>
          <a class="nav-link" routerLink="/ark/exit">Unilateral Exit</a>
          <a class="nav-link" routerLink="/ark/exit/simulate">Exit Simulator</a>
          <a class="nav-link" routerLink="/ark/providers">ASP Registry</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Backup Envelope Encryption</h5>
        <div class="row g-3">
          <div class="col-md-6">
            <div class="p-3 border rounded bg-body">
              <h6>Export Encrypted Package</h6>
              <p class="small text-muted mb-3">Envelopes are sealed with AES-GCM-256 derived from user passphrase. Safe for cloud sync.</p>
              <button class="btn btn-outline-primary btn-sm">Export Encrypted V-PACK</button>
            </div>
          </div>
          <div class="col-md-6">
            <div class="p-3 border rounded bg-body">
              <h6>Import & Decrypt Package</h6>
              <p class="small text-muted mb-3">Restore VTXO state across different wallet applications without ASP dependence.</p>
              <button class="btn btn-outline-secondary btn-sm">Import Sealed Envelope</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ArkBackupsComponent {}
