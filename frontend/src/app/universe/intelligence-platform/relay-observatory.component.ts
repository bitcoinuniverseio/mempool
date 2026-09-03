import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
          <span class="badge badge-success">4 Sensor Regions Online</span>
        </div>
        <p class="subtitle">
          Real-time measurement of transaction propagation latencies and policy divergences across Universe-operated Bitcoin nodes with peer privacy preservation.
        </p>
      </header>

      <!-- Fleet Overview Cards -->
      <section *ngIf="overview" class="row g-3 mb-4">
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">Median Network Latency</div>
            <div class="h3 my-1 text-primary">{{ overview.median_network_latency_ms }} ms</div>
            <div class="small text-muted">Trans-continental spread</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">BIP324 v2 Transport</div>
            <div class="h3 my-1 text-success">{{ overview.bip324_adoption_percent }}%</div>
            <div class="small text-muted">Encrypted P2P adoption</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">Erlay Reconciliation</div>
            <div class="h3 my-1 text-secondary">Unsupported</div>
            <div class="small text-muted">Awaiting Core 28 negotiation</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">Active Policy Divergences</div>
            <div class="h3 my-1 text-warning">{{ overview.active_policy_divergences_count }}</div>
            <div class="small text-muted">Full-RBF vs legacy</div>
          </div>
        </div>
      </section>

      <!-- Propagation Inspection -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h4 class="mb-0">Transaction Propagation Lifecycle</h4>
          <div class="d-flex gap-2">
            <input
              type="text"
              class="form-control form-control-sm font-monospace"
              style="width: 320px;"
              [(ngModel)]="searchTxid"
              placeholder="Search txid propagation..."
            />
            <button class="btn btn-sm btn-primary" (click)="searchTx()">Inspect</button>
          </div>
        </div>
        <div class="card-body" *ngIf="activeLifecycle">
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3 pb-3 border-bottom">
            <div>
              <div class="small text-muted">First observed by Universe sensors:</div>
              <div class="font-monospace">
                {{ activeLifecycle.first_observed_utc | date:'medium' }}
                <span class="text-muted">(±{{ activeLifecycle.first_observed_uncertainty_ms }}ms clock uncertainty)</span>
              </div>
            </div>
            <div class="d-flex gap-3">
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
          <div class="row text-center g-2 mb-4">
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
              <div *ngIf="diff.nodes_divergent.length > 0">
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
    .badge-primary { background-color: #0d6efd; color: #fff; }
    .badge-success { background-color: #198754; color: #fff; }
    .badge-warning { background-color: #ffc107; color: #000; }
    .badge-danger { background-color: #dc3545; color: #fff; }
    .badge-secondary { background-color: #6c757d; color: #fff; }
    .badge-light { background-color: #f8f9fa; color: #000; }
  `],
})
export class RelayObservatoryComponent implements OnInit {
  overview: any = null;
  activeLifecycle: any = null;
  policyDifferences: any[] = [];
  searchTxid = 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f';

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.getRelayOverview$().subscribe((res) => {
      this.overview = res;
      this.cdr.markForCheck();
    });

    this.api.getRelayPolicyDifferences$().subscribe((res) => {
      this.policyDifferences = res?.differences || [];
      this.cdr.markForCheck();
    });

    this.searchTx();
  }

  searchTx(): void {
    this.api.getRelayTransaction$(this.searchTxid).subscribe((res) => {
      this.activeLifecycle = res;
      this.cdr.markForCheck();
    });
  }
}
