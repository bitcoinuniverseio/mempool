import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { ReservesApiService, ReservesOverview } from './reserves.service';

@Component({
  selector: 'app-reserves-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Reserves and Solvency Verification Center</h1>
          <span class="badge bg-success" *ngIf="overview">
            {{ overview.overall_solvency_percentage }}% Tracked Solvency
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Cryptographic proof-of-reserves verification, BIP127 signature validation, Merkle sum tree liability audits, and noncustodial customer inclusion checks.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/intelligence/reserves">Overview</a>
          <a class="nav-link" routerLink="/intelligence/reserves/providers">Providers Directory</a>
          <a class="nav-link" routerLink="/intelligence/reserves/verify">Verify Proof</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Aggregating proof-of-reserves and liability snapshots...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="content-body">
        <!-- Metric Cards -->
        <section class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Tracked Reserve Balance</div>
              <div class="h4 my-1 text-primary">{{ (overview.total_tracked_reserve_sats / 100000000).toFixed(2) | number }} BTC</div>
              <div class="small text-muted">Onchain verified assets</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Tracked Liabilities</div>
              <div class="h4 my-1 text-secondary">{{ (overview.total_tracked_liability_sats / 100000000).toFixed(2) | number }} BTC</div>
              <div class="small text-muted">Attested customer claims</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Solvency Ratio</div>
              <div class="h4 my-1 text-success">{{ overview.overall_solvency_percentage }}%</div>
              <div class="small text-muted">Reserves / Liabilities</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Active Attestors</div>
              <div class="h4 my-1 text-info">{{ overview.active_providers_count }} Entities</div>
              <div class="small text-muted">Regular proof publishers</div>
            </div>
          </div>
        </section>

        <!-- Providers List -->
        <section class="card p-4 bg-body-tertiary border mb-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h2 class="h5 m-0">Custodial and Exchange Attestations</h2>
            <a class="btn btn-sm btn-outline-primary" routerLink="/intelligence/reserves/providers">View All Providers</a>
          </div>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Entity Name</th>
                  <th>Category</th>
                  <th>Standard</th>
                  <th class="text-end">Reserves</th>
                  <th class="text-end">Liabilities</th>
                  <th class="text-end">Solvency</th>
                  <th class="text-end">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let p of overview.providers">
                  <td>
                    <div class="fw-bold">{{ p.name }}</div>
                    <div class="small text-muted">Last at height {{ p.last_attestation_height }}</div>
                  </td>
                  <td>
                    <span class="badge bg-secondary text-capitalize">{{ p.category.replace('_', ' ') }}</span>
                  </td>
                  <td>
                    <span class="badge bg-info text-uppercase">{{ p.proof_standard }}</span>
                  </td>
                  <td class="text-end fw-semibold">{{ (p.total_reserve_sats / 100000000).toFixed(2) | number }} BTC</td>
                  <td class="text-end text-muted">{{ (p.total_liability_sats / 100000000).toFixed(2) | number }} BTC</td>
                  <td class="text-end">
                    <span class="badge" [ngClass]="p.solvency_ratio_percentage >= 100 ? 'bg-success' : 'bg-danger'">
                      {{ p.solvency_ratio_percentage }}%
                    </span>
                  </td>
                  <td class="text-end">
                    <a class="btn btn-sm btn-primary" [routerLink]="['/intelligence/reserves/provider', p.provider_id]">
                      Inspect
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Recent Snapshots -->
        <section class="card p-4 bg-body-tertiary border">
          <h2 class="h5 mb-3">Recent Onchain Attestation Snapshots</h2>
          <div class="table-responsive">
            <table class="table table-sm table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Snapshot ID</th>
                  <th>Block Height</th>
                  <th>UTXO Count</th>
                  <th>Signatures</th>
                  <th class="text-end">Reserves</th>
                  <th class="text-end">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let s of overview.recent_snapshots">
                  <td class="fw-bold font-monospace">{{ s.snapshot_id }}</td>
                  <td>{{ s.block_height }}</td>
                  <td>{{ s.utxo_count | number }}</td>
                  <td>{{ s.signature_count | number }}</td>
                  <td class="text-end fw-semibold">{{ (s.total_reserve_sats / 100000000).toFixed(2) | number }} BTC</td>
                  <td class="text-end">
                    <a class="btn btn-sm btn-outline-secondary" [routerLink]="['/intelligence/reserves/snapshot', s.snapshot_id]">
                      Details
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .intelligence-page {
      padding: 1.5rem 1rem 3rem;
    }
  `]
})
export class ReservesOverviewComponent implements OnInit, OnDestroy {
  public overview: ReservesOverview | null = null;
  public loading = true;
  public error = '';

  private sub?: Subscription;

  constructor(
    private reservesApi: ReservesApiService,
    private cd: ChangeDetectorRef,
  ) {}

  public ngOnInit(): void {
    this.sub = this.reservesApi.getOverview().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cd.markForCheck();
      },
      error: (err) => {
        this.error = err?.message || 'Failed to load reserves overview';
        this.loading = false;
        this.cd.markForCheck();
      },
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
