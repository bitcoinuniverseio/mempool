import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription, Subject, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { GlobalNetworkApiService, GlobalNetworkNodeDetail } from './global-network.service';
import { StateService } from '@app/services/state.service';
import { globalRead$ } from './global-network-observations';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-global-network-node-detail',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="d-flex align-items-center gap-2 mb-2">
          <a [routerLink]="'/network/global/nodes' | relativeUrl" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Nodes
          </a>
          <span class="text-muted small">Owned Bitcoin Peer Observatory</span>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Node Endpoint Inspection</h1>
          <span class="badge bg-success" *ngIf="node && node.transport_v2">
            Core Reports v2 Transport
          </span>
          <span class="badge bg-secondary" *ngIf="node && node.transport_v2 === false">
            v1 Standard Transport
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading node telemetry...</div>
      </div>

      <button type="button" class="btn btn-outline-primary mb-3" (click)="retry()" [disabled]="loading">Retry fresh read</button>
      <div *ngIf="error" role="alert" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && node" class="content-body">
        <p role="status">{{ node.scope }} Chain {{ node.chain_network }}; genesis {{ node.genesis_hash }};
          observed {{ node.observed_at_utc }} (reported age {{ node.age_ms }} ms / freshness {{ node.freshness_limit_ms }} ms).
          Peer transport {{ node.network }}. No independent operator or Signet challenge attestation.</p>
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
                  <span *ngIf="node.transport_v2 === null" class="text-muted">Transport unknown</span><span class="text-muted">BIP324 v2 Encrypted Transport</span>
                  <span class="badge bg-success" *ngIf="node.transport_v2">Supported</span>
                  <span class="badge bg-secondary" *ngIf="node.transport_v2 === false">Not Advertised</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">BIP155 addrv2 Extended Gossip</span>
                  <span class="badge bg-info" *ngIf="node.addrv2">Enabled</span>
                  <span class="badge bg-secondary" *ngIf="node.addrv2 !== true">Unknown</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Transaction Relay Flag</span>
                  <span class="fw-semibold">{{ node.relay === null ? 'Unknown' : node.relay ? 'True' : 'False' }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Advertised Services Bitmask</span>
                  <code class="fw-semibold">{{ node.services_hex === null ? 'Unknown' : '0x' + node.services_hex }}</code>
                </li>
              </ul>
            </div>
          </div>

          <div class="col-12 col-md-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h2 class="h5 mb-3">Network & Observation Metrics</h2>
              <ul class="list-group list-group-flush bg-transparent">
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Peer Advertised Start Height</span>
                  <span class="fw-semibold">{{ node.start_height | number }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Core Reported Ping Latency</span>
                  <span class="fw-semibold">{{ node.latency_ms !== null && node.latency_ms >= 0 ? node.latency_ms + ' ms' : 'n/a' }}</span>
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
            <div class="fw-semibold">Test TCP Reachability Separately</div>
            <div class="small text-muted">The separate self-check attempts TCP reachability; it does not verify Bitcoin handshakes.</div>
          </div>
          <a [routerLink]="'/network/global/self-check' | relativeUrl" class="btn btn-primary">
            Run Probe Self-Check
          </a>
        </div>
      </div>
    </div>
  `,
})
export class GlobalNetworkNodeDetailComponent implements OnInit, OnDestroy {
  node: GlobalNetworkNodeDetail | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();
  private retrySignal = new Subject<void>();
  constructor(private route: ActivatedRoute, private api: GlobalNetworkApiService, private cd: ChangeDetectorRef,
    private state: StateService | null = inject(StateService, { optional: true })) {}
  ngOnInit(): void {
    this.sub.add(this.route.paramMap.pipe(map(params => params.get('endpointId') || ''), distinctUntilChanged(),
      switchMap(endpoint => endpoint ? globalRead$(this.state, this.retrySignal, () => this.api.getNodeDetail$(endpoint))
        : of({ kind: 'error' as const, value: null, error: 'No peer endpoint was supplied.' }))).subscribe(result => {
      this.node = result.value; this.loading = result.kind === 'loading'; this.error = result.error; this.cd.markForCheck();
    }));
  }
  retry(): void { this.retrySignal.next(); }
  ngOnDestroy(): void { this.sub.unsubscribe(); this.retrySignal.complete(); }
}
