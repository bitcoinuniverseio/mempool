import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { PaymentConnectivityApiService, PaymentConnectivityOverview } from './payment-connectivity.service';

@Component({
  selector: 'app-payment-connectivity-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Nostr & Lightning Payment Connectivity Center</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            {{ overview.total_products }} Compatible Apps
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Authoritative compatibility and verification center for Nostr Wallet Connect (NIP-47), LNURL (LUD-01 through LUD-21), Lightning Address, and NIP-57 Zaps.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/payments">Overview</a>
          <a class="nav-link" routerLink="/payments/nwc">NWC Directory</a>
          <a class="nav-link" routerLink="/payments/nwc/inspect">NWC URI Inspector</a>
          <a class="nav-link" routerLink="/payments/nwc/compatibility">NWC Standards</a>
          <a class="nav-link" routerLink="/payments/lnurl">LNURL Specifications</a>
          <a class="nav-link" routerLink="/payments/lightning-address">Lightning Address</a>
          <a class="nav-link" routerLink="/payments/zaps">NIP-57 Zaps</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading payment connectivity status...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Ecosystem Applications</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_products }}</div>
            <div class="small text-muted mt-1">Verified clients and wallet services</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Reachable NWC Relays</div>
            <div class="fs-4 fw-bold text-success mt-1">{{ overview.active_relays }}</div>
            <div class="small text-muted mt-1">Direct WebSocket telemetry</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Verified Zaps Tracked</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.verified_zaps_count | number }}</div>
            <div class="small text-muted mt-1">Cryptographically linked invoice receipts</div>
          </div>
        </div>

        <div class="col-12 col-lg-8">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Verified Client & Wallet Applications</h2>
            <div class="table-responsive">
              <table class="table table-sm table-hover align-middle">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Vendor</th>
                    <th>NWC Client</th>
                    <th>NWC Service</th>
                    <th>LNURL</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let p of overview.featured_products">
                    <td class="fw-bold">{{ p.name }}</td>
                    <td class="text-muted small">{{ p.vendor }}</td>
                    <td>
                      <span class="badge" [ngClass]="p.nwc_client ? 'bg-success' : 'bg-secondary'">
                        {{ p.nwc_client ? 'YES' : 'NO' }}
                      </span>
                    </td>
                    <td>
                      <span class="badge" [ngClass]="p.nwc_wallet_service ? 'bg-success' : 'bg-secondary'">
                        {{ p.nwc_wallet_service ? 'YES' : 'NO' }}
                      </span>
                    </td>
                    <td>
                      <span class="badge" [ngClass]="p.lnurl_pay ? 'bg-success' : 'bg-secondary'">
                        {{ p.lnurl_pay ? 'LUD-06' : 'NO' }}
                      </span>
                    </td>
                    <td class="font-monospace fw-bold text-success">{{ p.compliance_score }}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Security & Secret Protection</h2>
            <div class="alert alert-info py-2 px-3 small mb-3">
              Client-Side Secret Masking:
            </div>
            <p class="small text-muted mb-0">
              Connection strings contain private client secrets in their query parameters. The NWC URI Inspector redacts secrets before logging or rendering to prevent credential leakage.
            </p>
            <div class="mt-3">
              <a routerLink="/payments/nwc/inspect" class="btn btn-outline-primary btn-sm w-100">
                Inspect NWC Connection URI &rarr;
              </a>
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
export class PaymentConnectivityOverviewComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  overview: PaymentConnectivityOverview | null = null;
  private sub?: Subscription;

  constructor(
    private paymentApi: PaymentConnectivityApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.paymentApi.getOverview$().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load payment connectivity overview';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
