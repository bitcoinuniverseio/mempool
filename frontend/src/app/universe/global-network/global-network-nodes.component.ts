import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, Subject } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { globalRead$, selectedGlobalNetwork } from './global-network-observations';
import { GlobalNetworkApiService, GlobalNetworkObservation, GlobalNetworkNodesReport } from './global-network.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-global-network-nodes',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Connected peers</h1>
          <span class="badge bg-secondary" *ngIf="totalCount > 0">
            {{ totalCount | number }} Active Endpoints
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Peers connected to our Bitcoin node. Filters apply to the current page.
        </p>

        <!-- Sub-navigation tabs -->
        <nav aria-label="Peer navigation" class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/network/global' | relativeUrl">Overview</a>
          <a class="nav-link active" aria-current="page" [routerLink]="'/network/global/nodes' | relativeUrl">Peers</a>
          <a class="nav-link" [routerLink]="'/network/global/snapshots' | relativeUrl">History</a>
          <a class="nav-link" [routerLink]="'/network/global/seeds' | relativeUrl">Discovery</a>
          <a class="nav-link" [routerLink]="'/network/global/self-check' | relativeUrl">Connection check</a>
        </nav>
      </header>

      <p *ngIf="report" role="status" class="text-muted">{{ report.chain_network | titlecase }} &bull; Showing {{ nodes.length }} of {{ totalCount }} peers</p>
      <details *ngIf="report" class="mb-3">
        <summary>Source details</summary>
        <p class="small text-muted text-break">{{ report.scope }} Network {{ report.chain_network }}; genesis {{ report.genesis_hash }};
        observed {{ report.observed_at_utc }} (reported age {{ report.age_ms }} ms / freshness {{ report.freshness_limit_ms }} ms).
        No independent operator or Signet challenge attestation. Page starts at offset {{ offset }}.</p>
      </details>
      <div class="d-flex gap-2 mb-3">
        <button type="button" class="btn btn-outline-secondary" (click)="previousPage()" [disabled]="loading || offset === 0">Previous peer page</button>
        <button type="button" class="btn btn-outline-secondary" (click)="nextPage()" [disabled]="loading || offset + nodes.length >= totalCount">Next peer page</button>
      </div>
      <div class="card p-3 mb-4 bg-body-tertiary border">
        <div class="row g-2 align-items-center">
          <div class="col-12 col-md-6">
            <input
              type="text"
              class="form-control"
              placeholder="Filter by IP, Onion, ASN, or User Agent..."
              [(ngModel)]="searchQuery"
              (ngModelChange)="applyFilter()"
              aria-label="Filter nodes"
            />
          </div>
          <div class="col-6 col-md-3">
            <select
              class="form-control"
              [(ngModel)]="transportFilter"
              (ngModelChange)="applyFilter()"
              aria-label="Filter by transport"
            >
              <option value="all">All Transports</option>
              <option value="v2">BIP324 v2 Encrypted Only</option>
              <option value="v1">v1 Plaintext Only</option>
            </select>
          </div>
          <div class="col-6 col-md-3 text-end text-muted small">
            Showing {{ filteredNodes.length }} of {{ totalCount }}
          </div>
        </div>
      </div>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Querying reachable node catalog...</div>
      </div>

      <button type="button" class="btn btn-outline-primary mb-3" (click)="retry()" [disabled]="loading">{{ error ? 'Retry' : 'Refresh' }}</button>
      <div *ngIf="error" role="alert" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && !error && report && filteredNodes.length === 0" class="alert alert-info my-3">
        No nodes matched the filter criteria.
      </div>

      <div *ngIf="!loading && !error && report && filteredNodes.length > 0" class="card bg-body-tertiary border">
        <div class="table-responsive" tabindex="0" role="region" aria-label="Owned Node Connected Peers, scroll horizontally" i18n-aria-label>
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Transport</th>
                <th>User Agent</th>
                <th>Height</th>
                <th>Core Ping</th>
                <th>ASN / Region</th>
                <th class="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let node of filteredNodes">
                <td>
                  <a [routerLink]="['/network/global/node' | relativeUrl, node.endpoint_id]" class="fw-semibold text-decoration-none">
                    {{ node.endpoint_id }}
                  </a>
                </td>
                <td>
                  <span class="badge bg-success" *ngIf="node.transport_v2">BIP324 v2</span>
                  <span class="badge bg-secondary" *ngIf="node.transport_v2 === false">v1 Standard</span>
                  <span class="badge bg-info ms-1" *ngIf="node.addrv2 === true">addrv2</span><span class="text-muted" *ngIf="node.transport_v2 === null">Transport unknown</span>
                </td>
                <td><code>{{ node.user_agent }}</code></td>
                <td>{{ node.start_height | number }}</td>
                <td>{{ node.latency_ms !== null && node.latency_ms >= 0 ? node.latency_ms + ' ms' : 'n/a' }}</td>
                <td>
                  <span class="badge bg-secondary me-1" *ngIf="node.country_code">{{ node.country_code }}</span>
                  <span class="text-muted small" *ngIf="node.asn">AS{{ node.asn }}</span>
                </td>
                <td class="text-end">
                  <a [routerLink]="['/network/global/node' | relativeUrl, node.endpoint_id]" class="btn btn-sm btn-outline-primary">
                    Inspect
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
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
      background-color: var(--u-brand);
      color: var(--u-brand-contrast);
    }
  `],
})
export class GlobalNetworkNodesComponent implements OnInit, OnDestroy {
  nodes: GlobalNetworkObservation[] = [];
  filteredNodes: GlobalNetworkObservation[] = [];
  report: GlobalNetworkNodesReport | null = null;
  totalCount = 0;
  offset = 0;
  loading = true;
  error: string | null = null;
  searchQuery = '';
  transportFilter = 'all';
  private pageContext = '';
  private sub = new Subscription();
  private retrySignal = new Subject<void>();
  constructor(private api: GlobalNetworkApiService, private cd: ChangeDetectorRef,
    private state: StateService | null = inject(StateService, { optional: true })) {}
  ngOnInit(): void {
    this.sub.add(globalRead$(this.state, this.retrySignal, () => {
      const context = selectedGlobalNetwork(this.state);
      if (context !== this.pageContext) { this.offset = 0; this.pageContext = context; }
      return this.api.getNodes$(100, this.offset);
    }).subscribe(result => {
      this.report = result.value; this.nodes = result.value?.nodes ?? []; this.totalCount = result.value?.total ?? 0;
      this.applyFilter(); this.loading = result.kind === 'loading'; this.error = result.error; this.cd.markForCheck();
    }));
  }
  retry(): void { this.retrySignal.next(); }
  nextPage(): void { if (!this.loading && this.offset + this.nodes.length < this.totalCount) { this.offset += 100; this.retry(); } }
  previousPage(): void { if (!this.loading && this.offset > 0) { this.offset = Math.max(0, this.offset - 100); this.retry(); } }
  applyFilter(): void {
    const q = this.searchQuery.toLowerCase().trim();
    this.filteredNodes = this.nodes.filter(node => {
      if (this.transportFilter === 'v2' && node.transport_v2 !== true) { return false; }
      if (this.transportFilter === 'v1' && node.transport_v2 !== false) { return false; }
      return !q || node.endpoint_id.toLowerCase().includes(q) || node.user_agent.toLowerCase().includes(q)
        || !!(node.asn && String(node.asn).includes(q)) || !!(node.country_code && node.country_code.toLowerCase().includes(q));
    });
    this.cd.markForCheck();
  }
  ngOnDestroy(): void { this.sub.unsubscribe(); this.retrySignal.complete(); }
}
