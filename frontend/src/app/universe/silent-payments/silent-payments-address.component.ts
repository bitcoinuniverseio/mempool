import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SilentPaymentsApiService } from './silent-payments.service';

@Component({
  selector: 'app-silent-payments-address',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">BIP352 Address & URI Validator</h1>
          <span class="badge bg-primary">Bech32m Stealth Standard</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Decode and verify BIP352 Silent Payment addresses (sp1 / tsp1) and BIP321 payment request URIs.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments/silent">Overview</a>
          <a class="nav-link" routerLink="/payments/silent/scan">In-Browser Scanner</a>
          <a class="nav-link active" routerLink="/payments/silent/address">Address Validator</a>
          <a class="nav-link" routerLink="/payments/silent/psbt">PSBT Inspector</a>
          <a class="nav-link" routerLink="/payments/silent/coverage">Indexing Coverage</a>
        </nav>
      </header>

      <!-- Input Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Validate Silent Payment Address or URI</h2>
        <form (ngSubmit)="validate()" #valForm="ngForm">
          <div class="mb-3">
            <label for="addressInput" class="form-label small text-muted">BIP352 Address or bitcoin: URI</label>
            <textarea
              id="addressInput"
              class="form-control font-monospace"
              rows="3"
              placeholder="e.g. sp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
              [(ngModel)]="rawInput"
              name="rawInput"
              required
            ></textarea>
          </div>

          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <button
              type="button"
              class="btn btn-outline-secondary"
              (click)="loadDemoAddress()"
            >
              Load Sample Address
            </button>
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="validating || !rawInput"
            >
              Validate Address
            </button>
          </div>
        </form>
      </div>

      <!-- Error State -->
      <div *ngIf="errorMessage" class="alert alert-danger mb-4" role="alert">
        {{ errorMessage }}
      </div>

      <!-- Decoded Results -->
      <div *ngIf="result" class="card p-4 bg-body-tertiary border">
        <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
          <h2 class="h5 m-0 text-success">&check; Valid BIP352 Address</h2>
          <span class="badge bg-secondary">{{ result.network | uppercase }}</span>
        </div>

        <div class="row g-3">
          <div class="col-12 col-md-6">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Scan Public Key (B_scan)</div>
              <code class="text-break small fw-bold">{{ result.scan_pubkey }}</code>
              <div class="small text-muted mt-1">Used by recipients to detect payments in block scan bundles</div>
            </div>
          </div>
          <div class="col-12 col-md-6">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Spend Public Key (B_spend)</div>
              <code class="text-break small fw-bold">{{ result.spend_pubkey }}</code>
              <div class="small text-muted mt-1">Combined with shared secret scalar to produce spending script</div>
            </div>
          </div>
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
export class SilentPaymentsAddressComponent {
  rawInput = '';
  validating = false;
  errorMessage: string | null = null;
  result: { valid: boolean; network?: string; scan_pubkey?: string; spend_pubkey?: string } | null = null;

  constructor(
    private api: SilentPaymentsApiService,
    private cd: ChangeDetectorRef
  ) {}

  loadDemoAddress(): void {
    this.rawInput = 'sp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
    this.validate();
  }

  validate(): void {
    if (!this.rawInput) return;
    this.validating = true;
    this.errorMessage = null;
    this.result = null;

    let address = this.rawInput.trim();
    if (address.startsWith('bitcoin:')) {
      const parts = address.slice(8).split('?');
      address = parts[0];
    }

    this.api.validateAddress$(address).subscribe({
      next: res => {
        if (res.valid) {
          this.result = res;
        } else {
          this.errorMessage = res.error || 'Invalid Silent Payment address.';
        }
        this.validating = false;
        this.cd.markForCheck();
      },
      error: err => {
        this.errorMessage = err?.error?.error || err?.message || 'Failed to validate address';
        this.validating = false;
        this.cd.markForCheck();
      },
    });
  }
}
