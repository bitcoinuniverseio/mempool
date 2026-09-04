import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { PayjoinApiService, PayjoinOverview } from './payjoin.service';

@Component({
  selector: 'app-payjoin-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Collaborative Payments and Payjoin Center</h1>
          <span class="badge bg-primary" *ngIf="overview">
            BIP78 & BIP77 Standards
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Two-party collaborative transactions that break the Common-Input-Ownership blockchain surveillance heuristic while preserving on-chain privacy.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/payments/payjoin">Overview</a>
          <a class="nav-link" routerLink="/payments/payjoin/analyze">Proposal Analyzer</a>
          <a class="nav-link" routerLink="/payments/payjoin/directory">Directory Observatory</a>
          <a class="nav-link" routerLink="/payments/payjoin/compatibility">Compatibility Matrix</a>
          <a class="nav-link" routerLink="/payments/payjoin/playground">Interactive Playground</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Payjoin ecosystem metrics...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="content-body">
        <!-- Metric Cards -->
        <section class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-lg-4">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Public Directory Relays</div>
              <div class="h4 my-1 text-primary">{{ overview.active_directories_count }}</div>
              <div class="small text-muted">BIP77 OHTTP capable</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-4">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Detected Payjoins (24h)</div>
              <div class="h4 my-1 text-success">{{ overview.total_payjoins_detected_24h }}</div>
              <div class="small text-muted">Multi-party input structures</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-4">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Heuristic Inversions (24h)</div>
              <div class="h4 my-1 text-info">{{ overview.common_input_heuristic_breaks_24h }}</div>
              <div class="small text-muted">Common-input assumptions broken</div>
            </div>
          </div>
        </section>

        <!-- Quick Explanation -->
        <section class="card p-4 bg-body-tertiary border mb-4">
          <h2 class="h5 mb-3">How Payjoin Protects Bitcoin Fungibility</h2>
          <div class="row g-3">
            <div class="col-12 col-md-4">
              <div class="p-3 border rounded bg-body h-100">
                <div class="fw-bold mb-1">1. Standard Payment Fallacy</div>
                <div class="small text-muted">
                  Chain surveillance algorithms assume that all inputs in a transaction belong to the exact same entity (the sender).
                </div>
              </div>
            </div>
            <div class="col-12 col-md-4">
              <div class="p-3 border rounded bg-body h-100">
                <div class="fw-bold mb-1">2. Receiver UTXO Addition</div>
                <div class="small text-muted">
                  With BIP78/BIP77, the receiver contributes an unspent output of their own to the transaction before the sender signs it.
                </div>
              </div>
            </div>
            <div class="col-12 col-md-4">
              <div class="p-3 border rounded bg-body h-100">
                <div class="fw-bold mb-1">3. Universal Doubt Injected</div>
                <div class="small text-muted">
                  External observers cannot identify which input belonged to the sender or the true payment amount, protecting the entire network.
                </div>
              </div>
            </div>
          </div>
        </section>
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
export class PayjoinOverviewComponent implements OnInit, OnDestroy {
  overview: PayjoinOverview | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: PayjoinApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getOverview$().subscribe({
        next: data => {
          this.overview = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load payjoin overview';
          this.loading = false;
          this.cd.markForCheck();
        },
      })
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
