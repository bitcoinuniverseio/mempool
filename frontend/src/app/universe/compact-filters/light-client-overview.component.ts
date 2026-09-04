import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { CompactFiltersApiService, CompactFilterOverview } from './compact-filters.service';

@Component({
  selector: 'app-light-client-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Compact Filter & Light-Client Verification Center</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            Tip Block #{{ overview.chain_filter_tip_height }}
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          BIP157/BIP158 compact block filter observatory, multi-peer filter header chain verification, and browser-side privacy-preserving descriptor scanner.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/network/light-client">Overview</a>
          <a class="nav-link" routerLink="/network/light-client/providers">Providers</a>
          <a class="nav-link" routerLink="/network/light-client/filters">Filter Explorer</a>
          <a class="nav-link" routerLink="/network/light-client/verify">Header Verifier</a>
          <a class="nav-link" routerLink="/network/light-client/scan">Local Scanner</a>
          <a class="nav-link" routerLink="/network/light-client/privacy">Privacy Controls</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading compact filter network status...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Advertising Peers</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_providers }}</div>
            <div class="small text-muted mt-1">NODE_COMPACT_FILTERS (bit 6)</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Verified Serving</div>
            <div class="fs-4 fw-bold text-success mt-1">{{ overview.verified_serving_providers }}</div>
            <div class="small text-muted mt-1">Confirmed getcfilters responses</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Filter Type</div>
            <div class="fs-4 fw-bold mt-1 font-monospace">{{ overview.basic_filter_type }}</div>
            <div class="small text-muted mt-1">BIP158 Basic (0x00) GCS</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Chain Checkpoints</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_checkpoints }}</div>
            <div class="small text-muted mt-1">Every 1,000 blocks</div>
          </div>
        </div>

        <div class="col-12 col-lg-8">
          <div class="card p-4 bg-body-tertiary border h-100">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h2 class="h5 m-0">Observed Compact Filter Peers</h2>
              <a routerLink="/network/light-client/providers" class="small text-decoration-none">View All &rarr;</a>
            </div>
            <div class="table-responsive">
              <table class="table table-sm table-hover align-middle">
                <thead>
                  <tr>
                    <th>Peer Address</th>
                    <th>Subversion</th>
                    <th>Filter Tip</th>
                    <th>Latency</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let p of overview.recent_providers">
                    <td>
                      <a [routerLink]="['/network/light-client/provider', p.provider_id]" class="font-monospace small text-decoration-none">
                        {{ p.address }}:{{ p.port }}
                      </a>
                    </td>
                    <td class="font-monospace small">{{ p.subversion }}</td>
                    <td class="font-monospace small">#{{ p.filter_tip_height }}</td>
                    <td class="small">{{ p.latency_ms }} ms</td>
                    <td>
                      <span class="badge" [ngClass]="p.actual_filter_serving_verified ? 'bg-success' : 'bg-warning text-dark'">
                        {{ p.actual_filter_serving_verified ? 'VERIFIED' : 'UNVERIFIED' }}
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
            <h2 class="h5 mb-3">Filter Checkpoints</h2>
            <div *ngFor="let cp of overview.checkpoints_sample" class="p-2 border rounded bg-body mb-2">
              <div class="d-flex justify-content-between">
                <span class="fw-bold small">Height #{{ cp.height }}</span>
                <span class="badge bg-secondary font-monospace small">1000-block interval</span>
              </div>
              <div class="text-muted font-monospace small text-truncate mt-1">
                Header: {{ cp.filter_header }}
              </div>
            </div>
            <div class="alert alert-info py-2 px-3 small m-0 mt-3">
              BIP157 multi-peer consensus validates filter headers against independent peers. In case of disagreement, full blocks are re-filtered to prove fault.
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
export class LightClientOverviewComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  overview: CompactFilterOverview | null = null;
  private sub?: Subscription;

  constructor(
    private cfApi: CompactFiltersApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.cfApi.getOverview$().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load compact filter overview';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
