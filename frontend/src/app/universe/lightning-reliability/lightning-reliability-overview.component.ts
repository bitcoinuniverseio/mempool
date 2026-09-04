import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { LightningReliabilityApiService, LightningReliabilityOverview } from './lightning-reliability.service';

@Component({
  selector: 'app-lightning-reliability-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Lightning Operational Reliability Center</h1>
          <span class="badge bg-success" *ngIf="overview">
            {{ overview.fleet_average_uptime_percentage }}% Fleet Uptime
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Multi-sensor reachability probes, public channel liquidity simulations, and non-invasive closure forensics across the Lightning Network.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/lightning/reliability">Reliability Overview</a>
          <a class="nav-link" routerLink="/lightning/liquidity">Liquidity Simulation</a>
          <a class="nav-link" routerLink="/lightning/lsp">LSP Directory</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Lightning fleet reliability telemetry...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="content-body">
        <!-- Metric Cards -->
        <section class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Probed Routing Nodes</div>
              <div class="h4 my-1 text-primary">{{ overview.total_probed_nodes | number }}</div>
              <div class="small text-muted">Active in public gossip</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Fleet Average Uptime (30d)</div>
              <div class="h4 my-1 text-success">{{ overview.fleet_average_uptime_percentage }}%</div>
              <div class="small text-muted">Multi-sensor verified</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Compliant LSP Providers</div>
              <div class="h4 my-1 text-info">{{ overview.active_lsp_providers_count }}</div>
              <div class="small text-muted">LSPS0 through LSPS5</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">24h Closure Dynamics</div>
              <div class="h4 my-1 text-warning">
                {{ overview.recent_closures_24h.cooperative + overview.recent_closures_24h.unilateral + overview.recent_closures_24h.penalty }}
              </div>
              <div class="small text-muted">
                {{ overview.recent_closures_24h.cooperative }} coop / {{ overview.recent_closures_24h.unilateral }} force
              </div>
            </div>
          </div>
        </section>

        <!-- Top Reliable Routing Nodes -->
        <section class="card p-4 bg-body-tertiary border mb-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h2 class="h5 m-0">Top Performing Routing Nodes</h2>
            <span class="text-muted small">Ranked by probe reachability score</span>
          </div>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Node Alias</th>
                  <th>Public Key</th>
                  <th class="text-end">Reachability Score</th>
                  <th class="text-end">30-Day Uptime</th>
                  <th class="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let node of overview.top_reliable_nodes">
                  <td class="fw-bold">{{ node.alias }}</td>
                  <td>
                    <code class="small">{{ node.pubkey.slice(0, 16) }}...{{ node.pubkey.slice(-8) }}</code>
                  </td>
                  <td class="text-end fw-semibold text-success">{{ node.score.toFixed(1) }}%</td>
                  <td class="text-end">{{ node.uptime.toFixed(2) }}%</td>
                  <td class="text-end">
                    <a [routerLink]="['/lightning/node', node.pubkey, 'reliability']" class="btn btn-sm btn-outline-primary">
                      Inspect Reliability
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
export class LightningReliabilityOverviewComponent implements OnInit, OnDestroy {
  overview: LightningReliabilityOverview | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: LightningReliabilityApiService,
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
          this.error = err?.message || 'Failed to load lightning reliability overview';
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
