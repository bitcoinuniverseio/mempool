import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { GlobalNetworkApiService, GlobalNetworkOverview } from './global-network.service';

@Component({
  selector: 'app-global-network-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Global Bitcoin Network Observatory</h1>
          <div class="d-flex gap-2">
            <span class="badge bg-success" *ngIf="overview">
              {{ overview.total_reachable_nodes | number }} Reachable Nodes
            </span>
            <span class="badge bg-primary" *ngIf="overview">
              {{ overview.sensors_count }} Sensors Active
            </span>
          </div>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Census, transport protocol adoption, and network topology across the global Bitcoin P2P fleet without peer tracking.
        </p>

        <!-- Sub-navigation tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/network/global">Overview</a>
          <a class="nav-link" routerLink="/network/global/nodes">Reachable Nodes</a>
          <a class="nav-link" routerLink="/network/global/snapshots">Snapshots Archive</a>
          <a class="nav-link" routerLink="/network/global/seeds">DNS Seeds</a>
          <a class="nav-link" routerLink="/network/global/self-check">Node Self-Check</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Global Bitcoin Network Census...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="content-body">
        <!-- Top Metrics Cards -->
        <section class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Active Crawl Epoch</div>
              <div class="h4 my-1 text-primary">{{ overview.active_epoch.epoch_id }}</div>
              <div class="small text-muted">{{ overview.active_epoch.status | titlecase }} status</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">BIP324 v2 Encrypted Transport</div>
              <div class="h4 my-1 text-success">{{ overview.bip324_v2_adoption_percentage }}%</div>
              <div class="small text-muted">{{ overview.active_epoch.v2_nodes | number }} verified v2 nodes</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">BIP155 addrv2 Adoption</div>
              <div class="h4 my-1 text-info">{{ overview.addrv2_adoption_percentage }}%</div>
              <div class="small text-muted">Tor v3, I2P, CJDNS capable</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Discovered Endpoints</div>
              <div class="h4 my-1 text-warning">{{ overview.active_epoch.discovered_nodes | number }}</div>
              <div class="small text-muted">Across all DNS seeds</div>
            </div>
          </div>
        </section>

        <!-- Transport Breakdown & Geo -->
        <div class="row g-4 mb-4">
          <div class="col-12 col-lg-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h2 class="h5 mb-3">Transport Protocol Breakdown</h2>
              <div class="table-responsive">
                <table class="table table-sm table-hover align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Protocol Transport</th>
                      <th class="text-end">Nodes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let t of overview.transport_breakdown">
                      <td>{{ t.transport }}</td>
                      <td class="text-end fw-semibold">{{ t.count | number }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="col-12 col-lg-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h2 class="h5 mb-3">Top Geographic Regions</h2>
              <div class="table-responsive">
                <table class="table table-sm table-hover align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Country Code</th>
                      <th class="text-end">Reachable Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let g of overview.geographic_distribution">
                      <td><span class="badge bg-secondary me-1">{{ g.country }}</span></td>
                      <td class="text-end fw-semibold">{{ g.count | number }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- Software Agent Versions -->
        <section class="card p-4 bg-body-tertiary border mb-4">
          <h2 class="h5 mb-3">Client Software Diversity</h2>
          <div class="table-responsive">
            <table class="table table-sm table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>User Agent</th>
                  <th class="text-end">Node Count</th>
                  <th class="text-end">Fleet Share</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let a of overview.top_user_agents">
                  <td><code>{{ a.agent }}</code></td>
                  <td class="text-end fw-semibold">{{ a.count | number }}</td>
                  <td class="text-end text-muted">{{ a.percentage }}%</td>
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
export class GlobalNetworkOverviewComponent implements OnInit, OnDestroy {
  overview: GlobalNetworkOverview | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: GlobalNetworkApiService,
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
          this.error = err?.message || 'Failed to load network overview';
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
