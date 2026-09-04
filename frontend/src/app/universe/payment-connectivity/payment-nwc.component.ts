import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { PaymentConnectivityApiService, NwcRelay } from './payment-connectivity.service';

@Component({
  selector: 'app-payment-nwc',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Nostr Wallet Connect (NIP-47) Relays</h1>
          <span class="badge bg-secondary" *ngIf="relays.length > 0">
            {{ relays.length }} Monitored Relays
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Direct WebSocket relay probing, NIP-11 information documents, latency measurements, and NIP-47 event support.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments">Overview</a>
          <a class="nav-link active" routerLink="/payments/nwc">NWC Directory</a>
          <a class="nav-link" routerLink="/payments/nwc/inspect">NWC URI Inspector</a>
          <a class="nav-link" routerLink="/payments/nwc/compatibility">NWC Standards</a>
          <a class="nav-link" routerLink="/payments/lnurl">LNURL Specifications</a>
          <a class="nav-link" routerLink="/payments/lightning-address">Lightning Address</a>
          <a class="nav-link" routerLink="/payments/zaps">NIP-57 Zaps</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Probing NWC relays...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && relays.length > 0" class="card p-4 bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Relay URL</th>
                <th>Software Version</th>
                <th>NIP-11 Document</th>
                <th>Latency</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let r of relays">
                <td class="font-monospace fw-bold">{{ r.url }}</td>
                <td class="font-monospace small">{{ r.software_version }}</td>
                <td>
                  <span class="badge" [ngClass]="r.nip11_supported ? 'bg-success' : 'bg-secondary'">
                    {{ r.nip11_supported ? 'AVAILABLE' : 'ABSENT' }}
                  </span>
                </td>
                <td class="font-monospace">{{ r.latency_ms }} ms</td>
                <td>
                  <span class="badge" [ngClass]="r.is_reachable ? 'bg-success' : 'bg-danger'">
                    {{ r.is_reachable ? 'ONLINE' : 'UNREACHABLE' }}
                  </span>
                </td>
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
export class PaymentNwcComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  relays: NwcRelay[] = [];
  private sub?: Subscription;

  constructor(
    private paymentApi: PaymentConnectivityApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.paymentApi.getRelays$().subscribe({
      next: (data) => {
        this.relays = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load relays';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
