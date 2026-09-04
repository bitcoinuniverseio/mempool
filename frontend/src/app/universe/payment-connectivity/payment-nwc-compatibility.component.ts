import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-payment-nwc-compatibility',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">NIP-47 Protocol Standards & Encryption</h1>
          <span class="badge bg-primary">NIP-44 v2 Required</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Detailed specification requirements for Nostr Wallet Connect event kinds, encryption upgrades, and authorization budgets.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments">Overview</a>
          <a class="nav-link" routerLink="/payments/nwc">NWC Directory</a>
          <a class="nav-link" routerLink="/payments/nwc/inspect">NWC URI Inspector</a>
          <a class="nav-link active" routerLink="/payments/nwc/compatibility">NWC Standards</a>
          <a class="nav-link" routerLink="/payments/lnurl">LNURL Specifications</a>
          <a class="nav-link" routerLink="/payments/lightning-address">Lightning Address</a>
          <a class="nav-link" routerLink="/payments/zaps">NIP-57 Zaps</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">NWC Event Kinds</h2>
            <div class="table-responsive">
              <table class="table table-sm table-bordered mb-0">
                <thead class="table-light">
                  <tr>
                    <th>Kind</th>
                    <th>Name</th>
                    <th>Direction</th>
                  </tr>
                </thead>
                <tbody class="small font-monospace">
                  <tr>
                    <td>13194</td>
                    <td>Info Event</td>
                    <td>Wallet &rarr; Client (Public capabilities)</td>
                  </tr>
                  <tr>
                    <td>23194</td>
                    <td>Request Event</td>
                    <td>Client &rarr; Wallet (Encrypted command)</td>
                  </tr>
                  <tr>
                    <td>23195</td>
                    <td>Response Event</td>
                    <td>Wallet &rarr; Client (Encrypted result)</td>
                  </tr>
                  <tr>
                    <td>23196</td>
                    <td>Notification Event</td>
                    <td>Wallet &rarr; Client (Incoming payment alert)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Encryption Transition: NIP-04 to NIP-44</h2>
            <div class="alert alert-warning py-2 px-3 small mb-3">
              Deprecation Notice:
            </div>
            <p class="small text-muted mb-3">
              Legacy NIP-04 encryption (CBC with PKCS#7) leaks message lengths and lacks cryptographic payload authentication. NIP-47 clients and services must transition to NIP-44 v2 (ChaCha20-Poly1305 with HMAC-SHA256 padding) for secure payload delivery.
            </p>
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Standard Commands Supported</div>
              <div class="d-flex flex-wrap gap-1 mt-1">
                <span class="badge bg-secondary font-monospace">pay_invoice</span>
                <span class="badge bg-secondary font-monospace">make_invoice</span>
                <span class="badge bg-secondary font-monospace">lookup_invoice</span>
                <span class="badge bg-secondary font-monospace">get_balance</span>
                <span class="badge bg-secondary font-monospace">get_budget</span>
                <span class="badge bg-secondary font-monospace">list_transactions</span>
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
export class PaymentNwcCompatibilityComponent {}
