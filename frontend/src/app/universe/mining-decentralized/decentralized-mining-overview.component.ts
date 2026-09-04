import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { DecentralizedMiningApiService, DecentralizedMiningOverview } from './decentralized-mining.service';

@Component({
  selector: 'app-decentralized-mining-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Decentralized Mining Sharechain Observatory</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            {{ overview.total_miners_active }} Independent Miners
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Sharechain tracking, DAG uncle branches, template autonomy metrics, and on-chain payout evidence for DATUM, P2Pool v2, and Braidpool.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/mining/decentralized">Overview</a>
          <a class="nav-link" routerLink="/mining/decentralized/datum">DATUM</a>
          <a class="nav-link" routerLink="/mining/decentralized/p2pool">P2Pool v2</a>
          <a class="nav-link" routerLink="/mining/decentralized/braidpool">Braidpool</a>
          <a class="nav-link" routerLink="/mining/decentralized/compare">Template Autonomy</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading decentralized mining telemetry...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Observed Shares</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_shares_observed | number }}</div>
            <div class="small text-muted mt-1">Across 3 sharechain networks</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Active Hashers</div>
            <div class="fs-4 fw-bold mt-1 text-success">{{ overview.total_miners_active }}</div>
            <div class="small text-muted mt-1">Individual mining endpoints</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Decentralized Hashrate</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.estimated_hashrate_ph }} PH/s</div>
            <div class="small text-muted mt-1">Combined estimated power</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Template Autonomy</div>
            <div class="fs-4 fw-bold text-primary mt-1">{{ overview.template_autonomy_percent }}%</div>
            <div class="small text-muted mt-1">Miners building own templates</div>
          </div>
        </div>

        <div class="col-12 col-lg-8">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Recent Validated Sharechain Submissions</h2>
            <div class="table-responsive">
              <table class="table table-sm table-hover align-middle">
                <thead>
                  <tr>
                    <th>Share ID</th>
                    <th>Protocol</th>
                    <th>Height</th>
                    <th>Miner Identity</th>
                    <th>Observed At</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let s of overview.recent_shares">
                    <td class="font-monospace small text-truncate" style="max-width: 140px;">{{ s.share_id }}</td>
                    <td>
                      <span class="badge" [ngClass]="s.protocol === 'datum' ? 'bg-primary' : s.protocol === 'p2pool' ? 'bg-success' : 'bg-info text-dark'">
                        {{ s.protocol | uppercase }}
                      </span>
                    </td>
                    <td class="font-monospace">#{{ s.share_height }}</td>
                    <td class="font-monospace small text-truncate" style="max-width: 140px;">{{ s.miner_identity }}</td>
                    <td class="small">{{ s.observed_at }}</td>
                    <td>
                      <a [routerLink]="['/mining/decentralized/share', s.share_id]" class="btn btn-sm btn-outline-primary">
                        Inspect
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Protocol Architecture</h2>
            <div class="p-3 border rounded bg-body mb-2">
              <div class="fw-bold">DATUM</div>
              <p class="small text-muted mb-0">Direct miner-to-pool template negotiation protocol eliminating centralized transaction filtering.</p>
            </div>
            <div class="p-3 border rounded bg-body mb-2">
              <div class="fw-bold">P2Pool v2</div>
              <p class="small text-muted mb-0">Decentralized peer-to-peer sharechain generating decentralized coinbase outputs via PPLNS.</p>
            </div>
            <div class="p-3 border rounded bg-body">
              <div class="fw-bold">Braidpool</div>
              <p class="small text-muted mb-0">DAG-based sharechain handling concurrent uncoordinated share blocks with multi-parent graphs.</p>
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
export class DecentralizedMiningOverviewComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  overview: DecentralizedMiningOverview | null = null;
  private sub?: Subscription;

  constructor(
    private miningApi: DecentralizedMiningApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.miningApi.getOverview$().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load decentralized mining overview';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
