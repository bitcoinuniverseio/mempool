import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BootstrapApiService, BootstrapOverview } from './bootstrap.service';

@Component({
  selector: 'app-bootstrap-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">AssumeUTXO & Node Bootstrap Snapshot Center</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            Recommended Snapshot: #{{ overview.recommended_snapshot_height }}
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Authoritative AssumeUTXO snapshot directory, UTXO set hash commitments, dual-chainstate sync telemetry, and fast node bootstrap planner.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/node/bootstrap">Overview</a>
          <a class="nav-link" routerLink="/node/bootstrap/snapshots">Snapshots</a>
          <a class="nav-link" routerLink="/node/bootstrap/verify">Integrity Verifier</a>
          <a class="nav-link" routerLink="/node/bootstrap/planner">Bootstrap Planner</a>
          <a class="nav-link" routerLink="/node/bootstrap/chainstates">Dual Chainstates</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading AssumeUTXO status...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Available Snapshots</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_snapshots }}</div>
            <div class="small text-muted mt-1">Pinned in Bitcoin Core</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Configured Nodes</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.configured_nodes_count }}</div>
            <div class="small text-muted mt-1">Connected instances</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Dual Chainstate Active</div>
            <div class="fs-4 fw-bold text-success mt-1">{{ overview.dual_chainstate_nodes_count }}</div>
            <div class="small text-muted mt-1">Background IBD + Fast Tip</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Bootstrap Acceleration</div>
            <div class="fs-4 fw-bold text-primary mt-1">~10x Faster</div>
            <div class="small text-muted mt-1">Instant mempool validation</div>
          </div>
        </div>

        <div class="col-12 col-lg-8">
          <div class="card p-4 bg-body-tertiary border h-100">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h2 class="h5 m-0">Pinned AssumeUTXO Snapshots</h2>
              <a routerLink="/node/bootstrap/snapshots" class="small text-decoration-none">View All &rarr;</a>
            </div>
            <div class="table-responsive">
              <table class="table table-sm table-hover align-middle">
                <thead>
                  <tr>
                    <th>Height</th>
                    <th>UTXO Coins Count</th>
                    <th>Size</th>
                    <th>Core Release</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let s of overview.featured_snapshots">
                    <td>
                      <a [routerLink]="['/node/bootstrap/snapshot', s.height]" class="fw-bold font-monospace text-decoration-none">
                        #{{ s.height }}
                      </a>
                    </td>
                    <td class="font-monospace small">{{ s.coins_count | number }}</td>
                    <td class="small">{{ (s.file_size_bytes / 1073741824).toFixed(2) }} GB</td>
                    <td class="font-monospace small">{{ s.release_version }}</td>
                    <td>
                      <span class="badge" [ngClass]="s.status === 'pinned_core' ? 'bg-success' : 'bg-secondary'">
                        {{ s.status }}
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
            <h2 class="h5 mb-3">AssumeUTXO Safety Architecture</h2>
            <div class="alert alert-info py-2 px-3 small mb-2">
              Full Validation Integrity:
            </div>
            <p class="small text-muted mb-3">
              AssumeUTXO loads an authentic serialized UTXO set at a hard-coded checkpoint block. The node can immediately participate in consensus and serve requests from the snapshot height while simultaneously running full validation of historical blocks from the genesis block in the background.
            </p>
            <a routerLink="/node/bootstrap/planner" class="btn btn-outline-primary btn-sm w-100">
              Calculate Bootstrap Time &rarr;
            </a>
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
export class BootstrapOverviewComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  overview: BootstrapOverview | null = null;
  private sub?: Subscription;

  constructor(
    private bootstrapApi: BootstrapApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.bootstrapApi.getOverview$().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load bootstrap overview';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
