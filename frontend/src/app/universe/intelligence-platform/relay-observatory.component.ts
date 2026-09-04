import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-relay-observatory',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Distributed Relay and Policy Observatory</h1>
          <span class="badge badge-success" *ngIf="overview">
            {{ overview.online_sensor_regions_count || 0 }} Sensor Regions Online
          </span>
          <span class="badge badge-secondary" *ngIf="!overview && loadingOverview">
            Querying Sensor Fleet...
          </span>
        </div>
        <p class="subtitle">
          Real-time measurement of transaction propagation latencies and policy divergences across Universe-operated Bitcoin nodes with peer privacy preservation.
        </p>
      </header>

      <div *ngIf="overviewError" class="alert alert-danger mb-4">
        {{ overviewError }}
      </div>

      <!-- Fleet Overview Cards -->
      <section *ngIf="overview" class="row g-3 mb-4">
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle h-100">
            <div class="text-muted small">Median Network Latency</div>
            <div class="h3 my-1 text-primary">{{ overview.median_network_latency_ms }} ms</div>
            <div class="small text-muted">Trans-continental spread</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle h-100">
            <div class="text-muted small">BIP324 v2 Transport</div>
            <div class="h3 my-1 text-success">{{ overview.bip324_adoption_percent }}%</div>
            <div class="small text-muted">Encrypted P2P adoption</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle h-100">
            <div class="text-muted small">Erlay Reconciliation</div>
            <div class="h3 my-1 text-secondary">{{ overview.erlay_reconciliation_status || 'Unsupported' }}</div>
            <div class="small text-muted">{{ overview.erlay_reconciliation_detail || 'Protocol capability unadvertised' }}</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle h-100">
            <div class="text-muted small">Active Policy Divergences</div>
            <div class="h3 my-1 text-warning">{{ overview.active_policy_divergences_count }}</div>
            <div class="small text-muted">Full-RBF vs legacy</div>
          </div>
        </div>
      </section>

      <!-- Propagation Inspection -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Transaction Propagation Lifecycle</h4>
          <div class="d-flex gap-2 flex-wrap align-items-center">
            <input
              type="text"
              class="form-control form-control-sm font-monospace"
              style="min-width: 200px; max-width: 320px;"
              [(ngModel)]="searchTxid"
              placeholder="Search txid propagation..."
              aria-label="Search txid propagation"
            />
            <button
              type="button"
              class="btn btn-sm btn-primary"
              [disabled]="loadingSearch || !searchTxid.trim()"
              (click)="searchTx()"
            >
              {{ loadingSearch ? 'Searching...' : 'Inspect' }}
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              (click)="loadSampleTx()"
            >
              Load Sample
            </button>
          </div>
        </div>
        <div class="card-body">
          <div *ngIf="searchError" class="alert alert-danger mb-3">
            {{ searchError }}
          </div>

          <div *ngIf="!activeLifecycle && !loadingSearch && !searchError" class="p-3 rounded bg-dark-subtle text-muted small">
            Enter a transaction ID or load a sample to inspect propagation timings across worldwide sensor regions.
          </div>

          <div *ngIf="activeLifecycle">
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3 pb-3 border-bottom">
              <div>
                <div class="small text-muted">First observed by Universe sensors:</div>
                <div class="font-monospace text-break">
                  {{ activeLifecycle.first_observed_utc | date:'medium' }}
                  <span class="text-muted">(±{{ activeLifecycle.first_observed_uncertainty_ms }}ms clock uncertainty)</span>
                </div>
              </div>
              <div class="d-flex gap-3 flex-wrap">
                <div>
                  <span class="text-muted small">Spread Delta:</span>
                  <strong> {{ activeLifecycle.spread_delta_ms }} ms</strong>
                </div>
                <div>
                  <span class="text-muted small">BIP324 Transport:</span>
                  <strong> {{ (activeLifecycle.bip324_ratio * 100).toFixed(0) }}%</strong>
                </div>
              </div>
            </div>

            <!-- Latency Percentiles Bar -->
            <h6 class="text-uppercase small text-muted mb-2">Fleet Propagation Percentiles</h6>
            <div class="row text-center g-2 mb-4" *ngIf="activeLifecycle.latency_percentiles">
              <div class="col">
                <div class="p-2 rounded bg-dark-subtle">
                  <div class="small text-muted">p25</div>
                  <div class="fw-bold">{{ activeLifecycle.latency_percentiles.p25_ms }} ms</div>
                </div>
              </div>
              <div class="col">
                <div class="p-2 rounded bg-dark-subtle">
                  <div class="small text-muted">p50 (Median)</div>
                  <div class="fw-bold text-primary">{{ activeLifecycle.latency_percentiles.p50_ms }} ms</div>
                </div>
              </div>
              <div class="col">
                <div class="p-2 rounded bg-dark-subtle">
                  <div class="small text-muted">p75</div>
                  <div class="fw-bold">{{ activeLifecycle.latency_percentiles.p75_ms }} ms</div>
                </div>
              </div>
              <div class="col">
                <div class="p-2 rounded bg-dark-subtle">
                  <div class="small text-muted">p90</div>
                  <div class="fw-bold text-warning">{{ activeLifecycle.latency_percentiles.p90_ms }} ms</div>
                </div>
              </div>
              <div class="col">
                <div class="p-2 rounded bg-dark-subtle">
                  <div class="small text-muted">p100 (Max)</div>
                  <div class="fw-bold text-danger">{{ activeLifecycle.latency_percentiles.p100_ms }} ms</div>
                </div>
              </div>
            </div>

            <!-- Sensor Observations Timeline -->
            <div class="table-responsive">
              <table class="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Sensor Deployment Region</th>
                    <th>Observed Timestamp</th>
                    <th>Relative Delta</th>
                    <th>Transport</th>
                    <th>Policy Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let obs of activeLifecycle.observations">
                    <td>
                      <strong>{{ obs.node_name }}</strong>
                      <div class="small text-muted">{{ obs.region }}</div>
                    </td>
                    <td class="font-monospace small">{{ obs.arrived_at_utc | date:'mediumTime' }}</td>
                    <td>
                      <span class="badge" [ngClass]="obs.delta_from_first_ms === 0 ? 'badge-success' : 'badge-secondary'">
                        +{{ obs.delta_from_first_ms }} ms
                      </span>
                    </td>
                    <td>
                      <span class="badge" [ngClass]="obs.transport_type === 'bip324' ? 'badge-primary' : 'badge-light'">
                        {{ obs.transport_type | uppercase }}
                      </span>
                    </td>
                    <td>
                      <span class="badge badge-success">Accepted</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- Policy Differences Matrix -->
      <section class="card mb-4" *ngIf="policyDifferences.length > 0">
        <div class="card-header">
          <h4 class="mb-0">Sensor Fleet Policy Differences</h4>
        </div>
        <div class="card-body">
          <div *ngFor="let diff of policyDifferences" class="mb-3">
            <h5>{{ diff.policy }}</h5>
            <p class="text-muted small">{{ diff.description }}</p>
            <div class="d-flex gap-4 flex-wrap">
              <div>
                <span class="badge badge-success mb-1">Aligned Nodes</span>
                <ul class="list-unstyled small mb-0 font-monospace">
                  <li *ngFor="let n of diff.nodes_aligned">{{ n }}</li>
                </ul>
              </div>
              <div *ngIf="diff.nodes_divergent?.length > 0">
                <span class="badge badge-warning mb-1">Divergent Nodes</span>
                <ul class="list-unstyled small mb-0 font-monospace">
                  <li *ngFor="let n of diff.nodes_divergent">{{ n }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .intelligence-page { padding-top: 2rem; padding-bottom: 4rem; }
    .page-header { margin-bottom: 2rem; }
    .title-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .badge {
      display: inline-block; padding: 0.35em 0.65em; font-size: 0.75em;
      font-weight: 700; line-height: 1; text-align: center; white-space: nowrap;
      vertical-align: baseline; border-radius: 0.25rem;
    }
    .badge-primary { background-color: var(--primary, #0d6efd); color: #fff; }
    .badge-success { background-color: var(--success, #198754); color: #fff; }
    .badge-warning { background-color: var(--warning, #ffc107); color: #000; }
    .badge-danger { background-color: var(--danger, #dc3545); color: #fff; }
    .badge-secondary { background-color: var(--secondary, #6c757d); color: #fff; }
    .badge-light { background-color: #f8f9fa; color: #000; }
  `],
})
export class RelayObservatoryComponent implements OnInit, OnDestroy {
  overview: any = null;
  loadingOverview = false;
  overviewError: string | null = null;

  activeLifecycle: any = null;
  loadingSearch = false;
  searchError: string | null = null;
  searchTxid = '';

  policyDifferences: any[] = [];

  private subs: Subscription[] = [];

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadingOverview = true;
    this.subs.push(
      this.api.getRelayOverview$().subscribe({
        next: (res) => {
          this.overview = res;
          this.loadingOverview = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.overviewError = err?.message || 'Failed to fetch relay overview';
          this.loadingOverview = false;
          this.cdr.markForCheck();
        },
      })
    );

    this.subs.push(
      this.api.getRelayPolicyDifferences$().subscribe({
        next: (res) => {
          this.policyDifferences = res?.differences || [];
          this.cdr.markForCheck();
        },
        error: () => {
          this.cdr.markForCheck();
        },
      })
    );
  }

  loadSampleTx(): void {
    this.searchTxid = 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f';
    this.searchTx();
  }

  searchTx(): void {
    if (!this.searchTxid.trim()) return;
    this.loadingSearch = true;
    this.searchError = null;
    this.cdr.markForCheck();

    this.subs.push(
      this.api.getRelayTransaction$(this.searchTxid.trim()).subscribe({
        next: (res) => {
          this.activeLifecycle = res;
          this.loadingSearch = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.searchError = err?.error?.error || err?.message || 'Transaction not observed by sensor fleet';
          this.loadingSearch = false;
          this.cdr.markForCheck();
        },
      })
    );
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
  }
}
