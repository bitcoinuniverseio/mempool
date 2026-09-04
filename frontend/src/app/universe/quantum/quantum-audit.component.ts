import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { QuantumApiService, QuantumPubkeyExposure } from './quantum.service';

@Component({
  selector: 'app-quantum-audit',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Local Public-Data Quantum Audit</h1>
          <span class="badge bg-success">Noncustodial Public Key Audit</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Assess vulnerability to Shor's algorithm for public addresses and outpoints. Never input private keys or recovery phrases.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/intelligence/quantum">Overview</a>
          <a class="nav-link" routerLink="/intelligence/quantum/exposure">Script Cohorts</a>
          <a class="nav-link" routerLink="/intelligence/quantum/history">Reveal Timeline</a>
          <a class="nav-link active" routerLink="/intelligence/quantum/audit">Local Public Audit</a>
          <a class="nav-link" routerLink="/intelligence/quantum/migration">Migration Planner</a>
        </nav>
      </header>

      <!-- Input Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Audit Public Identifier</h2>
        <form (ngSubmit)="audit()" #auditForm="ngForm">
          <div class="mb-3">
            <label for="identifierInput" class="form-label small text-muted">
              Bitcoin Address (e.g. 1..., bc1q..., bc1p...) or Outpoint (txid:vout)
            </label>
            <input
              id="identifierInput"
              type="text"
              class="form-control font-monospace"
              placeholder="e.g. bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"
              [(ngModel)]="identifier"
              name="identifier"
              required
              [disabled]="auditing"
            />
          </div>

          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <button
              type="button"
              class="btn btn-outline-secondary"
              (click)="loadDemoIdentifier()"
            >
              Load Sample Address
            </button>
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="auditing || !identifier"
            >
              <span *ngIf="auditing" class="spinner-border spinner-border-sm me-1" role="status"></span>
              {{ auditing ? 'Auditing...' : 'Run Quantum Audit' }}
            </button>
          </div>
        </form>
      </div>

      <!-- Error State -->
      <div *ngIf="errorMessage" class="alert alert-danger mb-4" role="alert">
        {{ errorMessage }}
      </div>

      <!-- Result Card -->
      <div *ngIf="result" class="card p-4 bg-body-tertiary border">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 border-bottom pb-2">
          <h2 class="h5 m-0" [ngClass]="result.is_exposed ? 'text-danger' : 'text-success'">
            {{ result.is_exposed ? '&cross; Quantum Exposed' : '&check; Hash-Protected' }}
          </h2>
          <span class="badge bg-secondary">{{ result.script_type | uppercase }}</span>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-12 col-md-6">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Vulnerability Classification</div>
              <div class="h5 my-1" [ngClass]="result.is_exposed ? 'text-danger' : 'text-success'">
                {{ result.exposure_reason | uppercase }}
              </div>
              <div class="small text-muted" *ngIf="result.is_exposed">
                Direct public key revealed on-chain. An adversary with a cryptographically relevant quantum computer could compute the private key.
              </div>
              <div class="small text-muted" *ngIf="!result.is_exposed">
                Public key hidden behind SHA256 and RIPEMD160 hashes until first spending transaction.
              </div>
            </div>
          </div>

          <div class="col-12 col-md-6">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Associated Outpoint</div>
              <code class="small text-break fw-bold">{{ result.outpoint }}</code>
              <div class="small text-muted mt-2">
                Value: {{ (result.amount_sats / 100000000).toFixed(4) }} BTC ({{ result.amount_sats | number }} sats)
              </div>
            </div>
          </div>
        </div>

        <div *ngIf="result.is_exposed" class="d-flex justify-content-end">
          <a routerLink="/intelligence/quantum/migration" class="btn btn-warning text-dark">
            Generate Migration Plan &rarr;
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link {
      color: inherit;
      padding: 0.4rem 0.8rem;
      border-radius: 0.375rem;
    }
    .nav-link.active {
      background-color: var(--bs-primary, #f7931a);
      color: #fff;
    }
  `],
})
export class QuantumAuditComponent {
  identifier = '';
  auditing = false;
  errorMessage: string | null = null;
  result: QuantumPubkeyExposure | null = null;

  constructor(
    private api: QuantumApiService,
    private cd: ChangeDetectorRef
  ) {}

  loadDemoIdentifier(): void {
    this.identifier = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
    this.audit();
  }

  audit(): void {
    if (!this.identifier) return;
    this.auditing = true;
    this.errorMessage = null;
    this.result = null;

    this.api.auditIdentifier$(this.identifier.trim()).subscribe({
      next: res => {
        this.result = res;
        this.auditing = false;
        this.cd.markForCheck();
      },
      error: err => {
        this.errorMessage = err?.error?.error || err?.message || 'Failed to audit identifier';
        this.auditing = false;
        this.cd.markForCheck();
      },
    });
  }
}
