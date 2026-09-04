import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { PaymentConnectivityApiService, LnurlEndpoint } from './payment-connectivity.service';

@Component({
  selector: 'app-payment-lnurl',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">LNURL Specifications & Providers</h1>
          <span class="badge bg-secondary" *ngIf="providers.length > 0">
            {{ providers.length }} Providers
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Compliance tracking for LNURL LUD-01 through LUD-21: PayRequest, WithdrawRequest, Auth, and Payment Verification endpoints.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments">Overview</a>
          <a class="nav-link" routerLink="/payments/nwc">NWC Directory</a>
          <a class="nav-link" routerLink="/payments/nwc/inspect">NWC URI Inspector</a>
          <a class="nav-link" routerLink="/payments/nwc/compatibility">NWC Standards</a>
          <a class="nav-link active" routerLink="/payments/lnurl">LNURL Specifications</a>
          <a class="nav-link" routerLink="/payments/lightning-address">Lightning Address</a>
          <a class="nav-link" routerLink="/payments/zaps">NIP-57 Zaps</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading LNURL providers...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && providers.length > 0" class="card p-4 bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Sample Address</th>
                <th>LUD-06 (Pay)</th>
                <th>LUD-03 (Withdraw)</th>
                <th>LUD-16 (Address)</th>
                <th>LUD-21 (Verify)</th>
                <th>HTTPS</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let p of providers">
                <td class="fw-bold font-monospace">{{ p.domain }}</td>
                <td class="font-monospace small text-muted">{{ p.lightning_address_sample }}</td>
                <td><span class="badge" [ngClass]="p.capabilities.lud06_pay ? 'bg-success' : 'bg-secondary'">{{ p.capabilities.lud06_pay ? 'YES' : 'NO' }}</span></td>
                <td><span class="badge" [ngClass]="p.capabilities.lud03_withdraw ? 'bg-success' : 'bg-secondary'">{{ p.capabilities.lud03_withdraw ? 'YES' : 'NO' }}</span></td>
                <td><span class="badge" [ngClass]="p.capabilities.lud16_lightning_address ? 'bg-success' : 'bg-secondary'">{{ p.capabilities.lud16_lightning_address ? 'YES' : 'NO' }}</span></td>
                <td><span class="badge" [ngClass]="p.capabilities.lud21_payment_verification ? 'bg-success' : 'bg-secondary'">{{ p.capabilities.lud21_payment_verification ? 'YES' : 'NO' }}</span></td>
                <td><span class="badge" [ngClass]="p.is_https ? 'bg-success' : 'bg-danger'">{{ p.is_https ? 'ENFORCED' : 'INSECURE' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class PaymentLnurlComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  providers: LnurlEndpoint[] = [];
  private sub?: Subscription;

  constructor(
    private paymentApi: PaymentConnectivityApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.paymentApi.getLnurlProviders$().subscribe({
      next: (data) => {
        this.providers = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load LNURL providers';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
