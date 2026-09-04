import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-payment-lightning-address',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Lightning Address Architecture (LUD-16)</h1>
          <span class="badge bg-primary">HTTP Resolution</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Internet identifier protocol mapping human-readable email-style identifiers (user@domain) to Lightning invoices.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments">Overview</a>
          <a class="nav-link" routerLink="/payments/nwc">NWC Directory</a>
          <a class="nav-link" routerLink="/payments/nwc/inspect">NWC URI Inspector</a>
          <a class="nav-link" routerLink="/payments/nwc/compatibility">NWC Standards</a>
          <a class="nav-link" routerLink="/payments/lnurl">LNURL Specifications</a>
          <a class="nav-link active" routerLink="/payments/lightning-address">Lightning Address</a>
          <a class="nav-link" routerLink="/payments/zaps">NIP-57 Zaps</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Resolution Flow</h2>
            <div class="d-flex flex-column gap-3">
              <div class="p-3 border rounded bg-body">
                <div class="fw-bold">1. Identifier Extraction</div>
                <p class="small text-muted mb-0 mt-1 font-monospace">alice@stacker.news &rarr; name: alice, domain: stacker.news</p>
              </div>

              <div class="p-3 border rounded bg-body">
                <div class="fw-bold">2. Well-Known Endpoint Query</div>
                <p class="small text-muted mb-0 mt-1 font-monospace">GET https://stacker.news/.well-known/lnurlp/alice</p>
              </div>

              <div class="p-3 border rounded bg-body">
                <div class="fw-bold">3. Callback Invoice Generation</div>
                <p class="small text-muted mb-0 mt-1">Client specifies amount in millisatoshis and optional zap request to receive payment invoice.</p>
              </div>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Security & SSRF Safeguards</h2>
            <div class="alert alert-info py-2 px-3 small mb-3">
              Server-Side Request Forgery (SSRF) Prevention:
            </div>
            <ul class="list-group list-group-flush small text-muted">
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; HTTPS is strictly required. Plain HTTP schemes are rejected immediately.
              </li>
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; RFC 1918 private IPv4 networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) and link-local addresses (169.254.0.0/16) are blocked from HTTP resolution.
              </li>
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; Loopback addresses (127.0.0.1, ::1) are prevented to protect internal cloud infrastructure.
              </li>
            </ul>
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
export class PaymentLightningAddressComponent {}
