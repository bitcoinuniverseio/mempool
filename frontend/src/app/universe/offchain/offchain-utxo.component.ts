import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { OffchainApiService, OffchainOverview } from './offchain.service';

@Component({
  selector: 'app-offchain-utxo',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Off-Chain UTXO Recovery & Verification Center</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            {{ overview.total_operators }} Active Entities
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Verifiable inspection, backup-transaction validity, locktime scheduling, and unilateral recovery for Mercury-style statechains and Teleport CoinSwaps.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/offchain/utxo">Overview</a>
          <a class="nav-link" routerLink="/offchain/statechains/operators">Statechains</a>
          <a class="nav-link" routerLink="/offchain/statechains/verify">Transfer Verifier</a>
          <a class="nav-link" routerLink="/offchain/coinswap">CoinSwap</a>
          <a class="nav-link" routerLink="/offchain/coinswap/inspect">CoinSwap Inspector</a>
          <a class="nav-link" routerLink="/offchain/recovery">Recovery Planner</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading off-chain UTXO telemetry...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Registered Operators</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_operators }}</div>
            <div class="small text-success mt-1">{{ overview.active_operators }} operational</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Active Public Offers</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.active_offers_count }}</div>
            <div class="small text-muted mt-1">Statechain deposits and maker offers</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Recovery Procedures</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.recent_recoveries_count }}</div>
            <div class="small text-muted mt-1">Unilateral locktime exits analyzed</div>
          </div>
        </div>

        <div class="col-12 col-lg-8">
          <div class="card p-4 bg-body-tertiary border h-100">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h2 class="h5 m-0">Observed Protocol Operators</h2>
              <a routerLink="/offchain/statechains/operators" class="small text-decoration-none">View All &rarr;</a>
            </div>
            <div class="table-responsive">
              <table class="table table-sm table-hover align-middle">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Protocol</th>
                    <th>Endpoint</th>
                    <th>Fee Rate</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let op of overview.featured_operators">
                    <td>
                      <a [routerLink]="['/offchain/statechains/operator', op.operator_id]" class="fw-bold text-decoration-none">
                        {{ op.display_name }}
                      </a>
                    </td>
                    <td>
                      <span class="badge bg-secondary">{{ op.protocol }}</span>
                    </td>
                    <td class="font-monospace small text-truncate" style="max-width: 180px;">
                      {{ op.endpoint }}
                    </td>
                    <td class="small">{{ op.published_terms.fee_rate_basis_points / 100 }}%</td>
                    <td>
                      <span class="badge" [ngClass]="op.health === 'healthy' ? 'bg-success' : 'bg-warning text-dark'">
                        {{ op.health | uppercase }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Security & Privacy Invariants</h2>
            <div class="alert alert-info py-2 px-3 small mb-3">
              Client-side verification is mandatory. In blinded statechains, the server cannot inspect transaction internals.
            </div>
            <ul class="list-group list-group-flush small text-muted">
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; No private keys, seed phrases, or cookies are ever requested or accepted.
              </li>
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; Decrementing timelocks must be verified across every transfer hop.
              </li>
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; Tor-only endpoints are routed without clearnet leakage.
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
export class OffchainUtxoComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  overview: OffchainOverview | null = null;
  private sub?: Subscription;

  constructor(
    private offchainApi: OffchainApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.offchainApi.getOverview$().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load off-chain overview';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
