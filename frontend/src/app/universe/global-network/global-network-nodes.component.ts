import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { GlobalNetworkApiService, GlobalNetworkObservation } from './global-network.service';

@Component({
  selector: 'app-global-network-nodes',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Global Reachable Bitcoin Nodes</h1>
          <span class="badge bg-secondary" *ngIf="totalCount > 0">
            {{ totalCount | number }} Active Endpoints
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Directly probed Bitcoin P2P nodes advertising standard and encrypted BIP324 transport capabilities.
        </p>

        <!-- Sub-navigation tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/network/global">Overview</a>
          <a class="nav-link active" routerLink="/network/global/nodes">Reachable Nodes</a>
          <a class="nav-link" routerLink="/network/global/snapshots">Snapshots Archive</a>
          <a class="nav-link" routerLink="/network/global/seeds">DNS Seeds</a>
          <a class="nav-link" routerLink="/network/global/self-check">Node Self-Check</a>
        </nav>
      </header>

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
              class="form-select"
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

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && filteredNodes.length === 0" class="alert alert-info my-3">
        No nodes matched the filter criteria.
      </div>

      <div *ngIf="!loading && filteredNodes.length > 0" class="card bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Transport</th>
                <th>User Agent</th>
                <th>Height</th>
                <th>Latency</th>
                <th>ASN / Region</th>
                <th class="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let node of filteredNodes">
                <td>
                  <a [routerLink]="['/network/global/node', node.endpoint_id]" class="fw-semibold text-decoration-none">
                    {{ node.endpoint_id }}
                  </a>
                </td>
                <td>
                  <span class="badge bg-success" *ngIf="node.transport_v2">BIP324 v2</span>
                  <span class="badge bg-secondary" *ngIf="!node.transport_v2">v1 Standard</span>
                  <span class="badge bg-info ms-1" *ngIf="node.addrv2">addrv2</span>
                </td>
                <td><code>{{ node.user_agent }}</code></td>
                <td>{{ node.start_height | number }}</td>
                <td>{{ node.latency_ms }} ms</td>
                <td>
                  <span class="badge bg-secondary me-1" *ngIf="node.country_code">{{ node.country_code }}</span>
                  <span class="text-muted small" *ngIf="node.asn">AS{{ node.asn }}</span>
                </td>
                <td class="text-end">
                  <a [routerLink]="['/network/global/node', node.endpoint_id]" class="btn btn-sm btn-outline-primary">
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
      background-color: var(--bs-primary, #f7931a);
      color: #fff;
    }
  `],
})
export class GlobalNetworkNodesComponent implements OnInit, OnDestroy {
  nodes: GlobalNetworkObservation[] = [];
  filteredNodes: GlobalNetworkObservation[] = [];
  totalCount = 0;
  loading = true;
  error: string | null = null;
  searchQuery = '';
  transportFilter = 'all';

  private sub = new Subscription();

  constructor(
    private api: GlobalNetworkApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getNodes$(100, 0).subscribe({
        next: res => {
          this.nodes = res.nodes;
          this.totalCount = res.total;
          this.applyFilter();
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load reachable nodes';
          this.loading = false;
          this.cd.markForCheck();
        },
      })
    );
  }

  applyFilter(): void {
    const q = this.searchQuery.toLowerCase().trim();
    this.filteredNodes = this.nodes.filter(node => {
      if (this.transportFilter === 'v2' && !node.transport_v2) return false;
      if (this.transportFilter === 'v1' && node.transport_v2) return false;
      if (!q) return true;
      return (
        node.endpoint_id.toLowerCase().includes(q) ||
        node.user_agent.toLowerCase().includes(q) ||
        (node.asn && String(node.asn).includes(q)) ||
        (node.country_code && node.country_code.toLowerCase().includes(q))
      );
    });
    this.cd.markForCheck();
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
