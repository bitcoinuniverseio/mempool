import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { LightningReliabilityApiService, LightningNodeReliability } from './lightning-reliability.service';

@Component({
  selector: 'app-lightning-node-reliability',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="d-flex align-items-center gap-2 mb-2">
          <a routerLink="/lightning/reliability" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Reliability Overview
          </a>
          <span class="text-muted small">Lightning Operational Reliability</span>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Node Reliability Inspection</h1>
          <span class="badge bg-success" *ngIf="node">
            {{ node.uptime_30d_percentage }}% Uptime (30d)
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading node reliability telemetry...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && node" class="content-body">
        <!-- Node Identity Summary -->
        <div class="card p-4 mb-4 bg-body-tertiary border">
          <div class="row g-3">
            <div class="col-12 col-md-4">
              <div class="text-muted small">Node Alias</div>
              <div class="h4 text-primary">{{ node.alias || 'Unnamed Node' }}</div>
            </div>
            <div class="col-12 col-md-8">
              <div class="text-muted small">Public Key</div>
              <div class="font-monospace text-break small">{{ node.node_pubkey }}</div>
            </div>
          </div>
        </div>

        <!-- Reliability Score Cards -->
        <div class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-md-4">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Reachability Score</div>
              <div class="h3 my-1 text-success">{{ node.reachability_score.toFixed(1) }}%</div>
              <div class="small text-muted">Direct sensor handshake success</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-4">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Gossip Freshness</div>
              <div class="h3 my-1 text-primary">{{ node.gossip_freshness_seconds }}s ago</div>
              <div class="small text-muted">Channel announcement timestamp</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-4">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Policy Volatility</div>
              <div class="h3 my-1 text-secondary">{{ (node.policy_volatility_score * 100).toFixed(1) }}%</div>
              <div class="small text-muted">Fee rate stability metric</div>
            </div>
          </div>
        </div>

        <!-- Probe History -->
        <div class="card p-4 bg-body-tertiary border">
          <h2 class="h5 mb-3">Multi-Region Sensor Probes</h2>
          <div *ngIf="node.probes.length === 0" class="text-muted small">
            No regional probe records logged during the active observation window.
          </div>
          <div *ngIf="node.probes.length > 0" class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Sensor Region</th>
                  <th>Handshake</th>
                  <th>Latency</th>
                  <th>LSPS Supported</th>
                  <th class="text-end">Observed At</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let p of node.probes">
                  <td class="fw-semibold">{{ p.sensor_region }}</td>
                  <td>
                    <span class="badge bg-success" *ngIf="p.handshake_success">Success</span>
                    <span class="badge bg-danger" *ngIf="!p.handshake_success">Failed</span>
                  </td>
                  <td>{{ p.latency_ms }} ms</td>
                  <td>
                    <span *ngFor="let s of p.lsps_supported" class="badge bg-secondary me-1">{{ s }}</span>
                  </td>
                  <td class="text-end text-muted small">{{ p.observed_at }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LightningNodeReliabilityComponent implements OnInit, OnDestroy {
  node: LightningNodeReliability | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private api: LightningReliabilityApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.route.paramMap.subscribe(params => {
        const pubkey = params.get('publicKey');
        if (pubkey) {
          this.fetchNode(pubkey);
        }
      })
    );
  }

  private fetchNode(pubkey: string): void {
    this.loading = true;
    this.sub.add(
      this.api.getNodeReliability$(pubkey).subscribe({
        next: data => {
          this.node = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.error?.error || err?.message || 'Failed to load node reliability';
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
