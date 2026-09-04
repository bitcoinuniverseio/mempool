import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SilentPaymentsApiService } from './silent-payments.service';

@Component({
  selector: 'app-silent-payments-psbt',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">BIP375 & BIP376 PSBT Inspector</h1>
          <span class="badge bg-primary">Hardware & Multisig Interoperability</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Inspect Partially Signed Bitcoin Transactions for BIP375 sending fields and BIP376 spending fields without exposing private keys.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments/silent">Overview</a>
          <a class="nav-link" routerLink="/payments/silent/scan">In-Browser Scanner</a>
          <a class="nav-link" routerLink="/payments/silent/address">Address Validator</a>
          <a class="nav-link active" routerLink="/payments/silent/psbt">PSBT Inspector</a>
          <a class="nav-link" routerLink="/payments/silent/coverage">Indexing Coverage</a>
        </nav>
      </header>

      <!-- PSBT Input Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Inspect PSBT Payload</h2>
        <form (ngSubmit)="inspect()" #psbtForm="ngForm">
          <div class="mb-3">
            <label for="psbtInput" class="form-label small text-muted">PSBT (Base64 Encoded)</label>
            <textarea
              id="psbtInput"
              class="form-control font-monospace"
              rows="4"
              placeholder="Paste base64 PSBT here (starts with cHNidP8...)"
              [(ngModel)]="rawPsbt"
              name="rawPsbt"
              required
            ></textarea>
          </div>

          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <button
              type="button"
              class="btn btn-outline-secondary"
              (click)="loadDemoPsbt()"
            >
              Load Sample PSBT
            </button>
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="inspecting || !rawPsbt"
            >
              Inspect Fields
            </button>
          </div>
        </form>
      </div>

      <!-- Error State -->
      <div *ngIf="errorMessage" class="alert alert-danger mb-4" role="alert">
        {{ errorMessage }}
      </div>

      <!-- Results -->
      <div *ngIf="result" class="card p-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">PSBT Standards Inspection Result</h2>
        <div class="row g-3">
          <div class="col-12 col-md-6">
            <div class="p-3 border rounded bg-body">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="fw-semibold">BIP375 Sending Fields</span>
                <span class="badge" [ngClass]="result.bip375_present ? 'bg-success' : 'bg-secondary'">
                  {{ result.bip375_present ? 'Detected' : 'Not Found' }}
                </span>
              </div>
              <div class="small text-muted">
                Proprietary key-value pairs specifying Silent Payment recipient addresses and output index mappings for signer verification.
              </div>
            </div>
          </div>

          <div class="col-12 col-md-6">
            <div class="p-3 border rounded bg-body">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="fw-semibold">BIP376 Spending Fields</span>
                <span class="badge" [ngClass]="result.bip376_present ? 'bg-success' : 'bg-secondary'">
                  {{ result.bip376_present ? 'Detected' : 'Not Found' }}
                </span>
              </div>
              <div class="small text-muted">
                Contains shared secret tweak scalar records and taproot internal key records for noncustodial signing.
              </div>
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
export class SilentPaymentsPsbtComponent {
  rawPsbt = '';
  inspecting = false;
  errorMessage: string | null = null;
  result: { valid: boolean; bip375_present: boolean; bip376_present: boolean } | null = null;

  constructor(
    private api: SilentPaymentsApiService,
    private cd: ChangeDetectorRef
  ) {}

  loadDemoPsbt(): void {
    this.rawPsbt = 'cHNidP8BAFICAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAAAAA==';
    this.inspect();
  }

  inspect(): void {
    if (!this.rawPsbt) return;
    this.inspecting = true;
    this.errorMessage = null;
    this.result = null;

    this.api.validatePsbt$(this.rawPsbt.trim()).subscribe({
      next: res => {
        if (res.valid) {
          this.result = res;
        } else {
          this.errorMessage = res.error || 'Invalid PSBT format.';
        }
        this.inspecting = false;
        this.cd.markForCheck();
      },
      error: err => {
        this.errorMessage = err?.error?.error || err?.message || 'Failed to inspect PSBT';
        this.inspecting = false;
        this.cd.markForCheck();
      },
    });
  }
}
