import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, Subject } from 'rxjs';
import { GlobalNetworkApiService, GlobalNetworkOverview } from './global-network.service';
import { StateService } from '@app/services/state.service';
import { globalRead$ } from './global-network-observations';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-global-network-overview',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Owned Bitcoin Peer Observatory</h1>
          <div class="d-flex gap-2">
            <span class="badge bg-success" *ngIf="overview">
              {{ overview.total_reachable_nodes | number }} Reachable Nodes
            </span>
            <span class="badge bg-primary" *ngIf="overview">
              {{ overview.sensors_count }} Reported Sensors
            </span>
          </div>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Capabilities reported for peers connected to this deployment's owned node. This is not a global network census or an independent operator comparison.
        </p>

        <!-- Sub-navigation tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" [routerLink]="'/network/global' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/network/global/nodes' | relativeUrl">Reachable Nodes</a>
          <a class="nav-link" [routerLink]="'/network/global/snapshots' | relativeUrl">Snapshots Archive</a>
          <a class="nav-link" [routerLink]="'/network/global/seeds' | relativeUrl">DNS Seeds</a>
          <a class="nav-link" [routerLink]="'/network/global/self-check' | relativeUrl">Node Self-Check</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading owned-peer observation...</div>
      </div>

      <button type="button" class="btn btn-outline-primary mb-3" (click)="retry()" [disabled]="loading">Retry fresh read</button>
      <div *ngIf="error" role="alert" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="content-body">
        <p role="status">Reported network: {{ overview.active_epoch.network }}. {{ overview.active_epoch.scope }}.
          Observed {{ overview.last_updated }}. No independent source profile, challenge, or global census is attested by this response.</p>
        <!-- Top Metrics Cards -->
        <section class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Owned Observation Epoch</div>
              <div class="h4 my-1 text-primary">{{ overview.active_epoch.epoch_id }}</div>
              <div class="small text-muted">{{ overview.active_epoch.status | titlecase }} status</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">BIP324 v2 Encrypted Transport</div>
              <div class="h4 my-1 text-success">{{ overview.bip324_v2_adoption_percentage === null ? 'Unknown' : overview.bip324_v2_adoption_percentage + '%' }}</div>
              <div class="small text-muted">{{ overview.active_epoch.v2_nodes | number }} peers reported with v2 transport</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">BIP155 addrv2 Adoption</div>
              <div class="h4 my-1 text-info">{{ overview.addrv2_adoption_percentage === null ? 'Unknown' : overview.addrv2_adoption_percentage + '%' }}</div>
              <div class="small text-muted">Peer addrv2 support is not measured by this response.</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Discovered Endpoints</div>
              <div class="h4 my-1 text-warning">{{ overview.active_epoch.discovered_nodes | number }}</div>
              <div class="small text-muted">Connected to the owned node</div>
            </div>
          </div>
        </section>

        <!-- Transport Breakdown & Geo -->
        <div class="row g-4 mb-4">
          <div class="col-12 col-lg-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h2 class="h5 mb-3">Transport Protocol Breakdown</h2>
              <div class="table-responsive" tabindex="0" role="region" aria-label="Transport Protocol Breakdown, scroll horizontally" i18n-aria-label>
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
              <div class="table-responsive" tabindex="0" role="region" aria-label="Top Geographic Regions, scroll horizontally" i18n-aria-label>
                <table class="table table-sm table-hover align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Country Code</th>
                      <th class="text-end">Reachable Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngIf="!overview.geographic_distribution?.length">
                      <td colspan="2" class="text-muted small">No geolocation source is configured; countries are not guessed.</td>
                    </tr>
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
          <div class="table-responsive" tabindex="0" role="region" aria-label="Client Software Diversity, scroll horizontally" i18n-aria-label>
            <table class="table table-sm table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>User Agent</th>
                  <th class="text-end">Node Count</th>
                  <th class="text-end">Observed Peer Share</th>
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
  private retrySignal = new Subject<void>();
  constructor(
    private api: GlobalNetworkApiService,
    private cd: ChangeDetectorRef,
    private state: StateService | null = inject(StateService, { optional: true })
  ) {}
  ngOnInit(): void {
    this.sub.add(globalRead$(this.state, this.retrySignal, () => this.api.getOverview$()).subscribe(result => {
      this.overview = result.value;
      this.loading = result.kind === 'loading'; this.error = result.error; this.cd.markForCheck();
    }));
  }
  retry(): void { this.retrySignal.next(); }
  ngOnDestroy(): void { this.sub.unsubscribe(); this.retrySignal.complete(); }
}
