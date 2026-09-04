import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { GlobalNetworkApiService, GlobalNetworkObservation } from './global-network.service';

@Component({
  selector: 'app-global-network-node-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="d-flex align-items-center gap-2 mb-2">
          <a routerLink="/network/global/nodes" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Nodes
          </a>
          <span class="text-muted small">Global Bitcoin Network Observatory</span>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Node Endpoint Inspection</h1>
          <span class="badge bg-success" *ngIf="node && node.transport_v2">
            BIP324 v2 Encrypted Active
          </span>
          <span class="badge bg-secondary" *ngIf="node && !node.transport_v2">
            v1 Standard Transport
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading node telemetry...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && node" class="content-body">
        <!-- Endpoint Primary Summary -->
        <div class="card p-4 mb-4 bg-body-tertiary border">
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <div class="text-muted small">Endpoint Address</div>
              <div class="h4 text-primary font-monospace text-break">{{ node.endpoint_id }}</div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-muted small">Software Client</div>
              <div class="h4 font-monospace">{{ node.user_agent }}</div>
            </div>
          </div>
        </div>

        <!-- Technical Telemetry Details -->
        <div class="row g-4 mb-4">
          <div class="col-12 col-md-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h2 class="h5 mb-3">Protocol Capabilities</h2>
              <ul class="list-group list-group-flush bg-transparent">
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">BIP324 v2 Encrypted Transport</span>
                  <span class="badge bg-success" *ngIf="node.transport_v2">Supported</span>
                  <span class="badge bg-secondary" *ngIf="!node.transport_v2">Not Advertised</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">BIP155 addrv2 Extended Gossip</span>
                  <span class="badge bg-info" *ngIf="node.addrv2">Enabled</span>
                  <span class="badge bg-secondary" *ngIf="!node.addrv2">Disabled</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Transaction Relay Flag</span>
                  <span class="fw-semibold">{{ node.relay ? 'True' : 'False' }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Advertised Services Bitmask</span>
                  <code class="fw-semibold">0x{{ node.services.toString(16) }}</code>
                </li>
              </ul>
            </div>
          </div>

          <div class="col-12 col-md-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h2 class="h5 mb-3">Network & Observation Metrics</h2>
              <ul class="list-group list-group-flush bg-transparent">
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Synchronized Start Height</span>
                  <span class="fw-semibold">{{ node.start_height | number }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Probe Handshake Latency</span>
                  <span class="fw-semibold">{{ node.latency_ms }} ms</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Autonomous System (ASN)</span>
                  <span class="fw-semibold">{{ node.asn ? 'AS' + node.asn : 'Unavailable' }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Country Jurisdiction</span>
                  <span class="badge bg-secondary">{{ node.country_code || 'Unknown' }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Last Observation Timestamp</span>
                  <span class="small text-muted">{{ node.observed_at }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div class="card p-3 bg-body-tertiary border d-flex flex-row justify-content-between align-items-center">
          <div>
            <div class="fw-semibold">Verify this Node Directly</div>
            <div class="small text-muted">Execute a privacy-preserving probe from Universe sensor probes.</div>
          </div>
          <a routerLink="/network/global/self-check" class="btn btn-primary">
            Run Probe Self-Check
          </a>
        </div>
      </div>
    </div>
  `,
})
export class GlobalNetworkNodeDetailComponent implements OnInit, OnDestroy {
  node: GlobalNetworkObservation | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private api: GlobalNetworkApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.route.paramMap.subscribe(params => {
        const endpointId = params.get('endpointId');
        if (endpointId) {
          this.fetchNode(endpointId);
        }
      })
    );
  }

  private fetchNode(endpointId: string): void {
    this.loading = true;
    this.sub.add(
      this.api.getNodeDetail$(endpointId).subscribe({
        next: data => {
          this.node = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.error?.error || err?.message || 'Failed to load node details';
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
