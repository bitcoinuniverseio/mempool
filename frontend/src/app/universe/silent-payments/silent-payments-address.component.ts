import { Subscription } from 'rxjs';
import { SILENT_PAYMENT_SAMPLE_ADDRESS } from './silent-payments-samples';
import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
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
          Decode BIP352 Silent Payment addresses (sp1 / tsp1), directly or from a BIP321 URI's sp instruction. Other payment methods in the URI are not inspected.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="api.path('/payments/silent')">Overview</a>
          <a class="nav-link" [routerLink]="api.path('/payments/silent/scan')">In-Browser Scanner</a>
          <a class="nav-link active" [routerLink]="api.path('/payments/silent/address')">Address Validator</a>
          <a class="nav-link" [routerLink]="api.path('/payments/silent/psbt')">PSBT Inspector</a>
          <a class="nav-link" [routerLink]="api.path('/payments/silent/coverage')">Indexing Coverage</a>
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
              placeholder="Paste a Bech32m Silent Payment address"
              [(ngModel)]="rawInput" (ngModelChange)="resetResult()" maxlength="4096"
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
              Load Official Mainnet Sample
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
              <div class="small text-muted mt-1">Public address component; receiving scans require its private scan capability</div>
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
    .btn-outline-secondary { color: var(--u-text-muted); border-color: var(--u-text-muted); }
    :host .text-muted, :host .form-control::placeholder {
      color: var(--u-text-muted, #a99cb5) !important;
      opacity: 1;
    }
    .nav-link {
      color: inherit;
      padding: 0.4rem 0.8rem;
      border-radius: 0.375rem;
    }
    .nav-link.active {
      background-color: var(--u-brand, #c40059);
      color: var(--u-brand-contrast, #fff);
    }
    :host .badge.bg-primary {
      background-color: var(--u-brand, #c40059) !important;
      color: var(--u-brand-contrast, #fff) !important;
    }
    :host .badge.bg-secondary {
      background-color: var(--u-state-neutral-surface, #edeaf1) !important;
      color: var(--u-state-neutral, #5e5769) !important;
    }
    :host .text-success { color: var(--u-state-proven, #0f6b3a) !important; }
  `],
})
export class SilentPaymentsAddressComponent implements OnDestroy {
  private request?: Subscription;
  private networkSub: Subscription;
  ngOnDestroy(): void { this.request?.unsubscribe(); this.networkSub.unsubscribe(); }
  resetResult(): void { this.request?.unsubscribe(); this.result = null; this.errorMessage = null; this.validating = false; }

  rawInput = '';
  validating = false;
  errorMessage: string | null = null;
  result: { valid: boolean; network?: string; scan_pubkey?: string; spend_pubkey?: string } | null = null;

  constructor(
    public api: SilentPaymentsApiService,
    private cd: ChangeDetectorRef
  ) { this.networkSub = this.api.networkChanges$.subscribe(() => { this.resetResult(); this.cd.markForCheck(); }); }

  loadDemoAddress(): void {
    this.rawInput = SILENT_PAYMENT_SAMPLE_ADDRESS;
    this.validate();
  }

  validate(): void {
    if (!this.rawInput) return;
    this.validating = true;
    this.errorMessage = null;
    this.result = null;

    this.request?.unsubscribe();
    this.request = this.api.validateAddress$(this.rawInput.trim()).subscribe({
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
