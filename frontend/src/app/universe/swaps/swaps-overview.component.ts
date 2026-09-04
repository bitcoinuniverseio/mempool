import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SwapsApiService, SwapsOverview } from './swaps.service';

@Component({
  selector: 'app-swaps-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Cross-Layer Atomic Swap and Submarine Swap Verification Center</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            {{ overview.active_providers_count }} Active Providers
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Authoritative on-chain verification of submarine swaps, reverse swaps, chain swaps, and reorg-safe recovery plans.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/swaps">Overview</a>
          <a class="nav-link" routerLink="/swaps/submarine">Submarine</a>
          <a class="nav-link" routerLink="/swaps/reverse">Reverse</a>
          <a class="nav-link" routerLink="/swaps/chain">Chain Swaps</a>
          <a class="nav-link" routerLink="/swaps/providers">Providers</a>
          <a class="nav-link" routerLink="/swaps/inspect">Inspector</a>
          <a class="nav-link" routerLink="/swaps/recover">Recovery Planner</a>
          <a class="nav-link" routerLink="/swaps/simulate">Simulator</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading atomic swap verification overview...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Observed Swaps</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_swaps_observed }}</div>
            <div class="small text-success mt-1">Cross-layer tracked</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Active Providers</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.active_providers_count }}</div>
            <div class="small text-muted mt-1">Signed manifests verified</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Total Volume</div>
            <div class="fs-4 fw-bold mt-1">{{ (overview.total_volume_sats / 100000000).toFixed(2) }} BTC</div>
            <div class="small text-muted mt-1">Settled and claimable</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Supported Protocols</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.supported_protocols_count }}</div>
            <div class="small text-info mt-1">Boltz, Loop, VHTLC</div>
          </div>
        </div>

        <div class="col-12">
          <div class="card bg-body-tertiary border p-3">
            <h5 class="card-title mb-3">Recent Cross-Layer Swap Settlements</h5>
            <div class="table-responsive">
              <table class="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Swap ID</th>
                    <th>Type</th>
                    <th>Network</th>
                    <th>Provider</th>
                    <th>Amount (sats)</th>
                    <th>Timeout Height</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let s of overview.recent_swaps">
                    <td class="text-truncate font-monospace" style="max-width: 180px;">{{ s.swap_id }}</td>
                    <td><span class="badge bg-dark">{{ s.swap_type | uppercase }}</span></td>
                    <td>{{ s.network }} <span *ngIf="s.secondary_network">→ {{ s.secondary_network }}</span></td>
                    <td>{{ s.provider_id }}</td>
                    <td>{{ s.expected_amount_sats | number }}</td>
                    <td class="font-monospace">{{ s.timeout_height }}</td>
                    <td>
                      <span class="badge" [ngClass]="s.status === 'claimed' ? 'bg-success' : 'bg-warning text-dark'">
                        {{ s.status }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SwapsOverviewComponent implements OnInit, OnDestroy {
  public overview: SwapsOverview | null = null;
  public loading = true;
  public error = '';
  private sub?: Subscription;

  constructor(private api: SwapsApiService, private cdr: ChangeDetectorRef) {}

  public ngOnInit(): void {
    this.sub = this.api.getOverview$().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load swap overview';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
