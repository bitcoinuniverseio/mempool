import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PaymentConnectivityApiService } from './payment-connectivity.service';

@Component({
  selector: 'app-payment-nwc-inspect',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">NWC Connection URI Inspector</h1>
          <span class="badge bg-success">Local Secret Redaction</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Inspect Nostr Wallet Connect pairing strings, parse service public keys, relay endpoints, and mask private secrets before export.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments">Overview</a>
          <a class="nav-link" routerLink="/payments/nwc">NWC Directory</a>
          <a class="nav-link active" routerLink="/payments/nwc/inspect">NWC URI Inspector</a>
          <a class="nav-link" routerLink="/payments/nwc/compatibility">NWC Standards</a>
          <a class="nav-link" routerLink="/payments/lnurl">LNURL Specifications</a>
          <a class="nav-link" routerLink="/payments/lightning-address">Lightning Address</a>
          <a class="nav-link" routerLink="/payments/zaps">NIP-57 Zaps</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Connection URI Input</h2>

            <div class="mb-3">
              <label class="form-label small text-muted">NWC Connection URI</label>
              <textarea
                class="form-control font-monospace small"
                rows="6"
                [(ngModel)]="uriInput"
                placeholder="nostr+walletconnect://<pubkey>?relay=wss%3A%2F%2F...&secret=..."
              ></textarea>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-primary" (click)="inspectUri()" [disabled]="inspecting">
                <span *ngIf="inspecting" class="spinner-border spinner-border-sm me-1"></span>
                Inspect URI
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load Sample URI
              </button>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Inspection Analysis</h2>

            <div *ngIf="!report && !inspecting" class="text-center py-5 text-muted">
              Paste an NWC pairing URI to analyze components with secret redaction.
            </div>

            <div *ngIf="inspecting" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Parsing query parameters and validating Nostr pubkeys...</div>
            </div>

            <div *ngIf="report">
              <div class="alert" [ngClass]="report.valid ? 'alert-success' : 'alert-danger'">
                <div class="fw-bold">{{ report.valid ? 'Valid NWC Connection String' : 'Invalid Connection URI' }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Masked Safe URI (Secret Redacted)</div>
                <div class="font-monospace small text-break mt-1">{{ report.masked_uri }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Wallet Service Public Key</div>
                <div class="font-monospace small text-break mt-1">{{ report.wallet_service_pubkey }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Declared Relays</div>
                <ul class="list-unstyled font-monospace small mb-0 mt-1">
                  <li *ngFor="let r of report.relays">&bull; {{ r }}</li>
                </ul>
              </div>

              <div *ngIf="report.errors && report.errors.length > 0" class="mb-3">
                <div class="text-danger small fw-bold mb-1">Errors</div>
                <ul class="list-group list-group-flush">
                  <li *ngFor="let err of report.errors" class="list-group-item bg-transparent text-danger small p-1">
                    &bull; {{ err }}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class PaymentNwcInspectComponent {
  uriInput = '';
  inspecting = false;
  report: any = null;

  constructor(
    private paymentApi: PaymentConnectivityApiService,
    private cdr: ChangeDetectorRef
  ) {
    this.loadSample();
  }

  loadSample(): void {
    this.uriInput =
      'nostr+walletconnect://0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798?relay=wss%3A%2F%2Frelay.damus.io&secret=112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00';
  }

  inspectUri(): void {
    this.inspecting = true;
    this.report = null;

    this.paymentApi.inspectNwcUri$(this.uriInput).subscribe({
      next: (res) => {
        this.report = res;
        this.inspecting = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.inspecting = false;
        this.report = {
          valid: false,
          errors: [err.message || 'Inspection error'],
        };
        this.cdr.markForCheck();
      },
    });
  }
}
