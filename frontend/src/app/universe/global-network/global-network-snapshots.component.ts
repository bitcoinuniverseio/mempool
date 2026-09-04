import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { GlobalNetworkApiService, GlobalNetworkSnapshot } from './global-network.service';

@Component({
  selector: 'app-global-network-snapshots',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Global Network Topology Snapshots</h1>
          <span class="badge bg-secondary" *ngIf="snapshots.length > 0">
            {{ snapshots.length }} Archives Available
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Historical periodic captures of global Bitcoin network reachability, protocol adoption, and decentralization metrics.
        </p>

        <!-- Sub-navigation tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/network/global">Overview</a>
          <a class="nav-link" routerLink="/network/global/nodes">Reachable Nodes</a>
          <a class="nav-link active" routerLink="/network/global/snapshots">Snapshots Archive</a>
          <a class="nav-link" routerLink="/network/global/seeds">DNS Seeds</a>
          <a class="nav-link" routerLink="/network/global/self-check">Node Self-Check</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading topology snapshot archives...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && snapshots.length > 0" class="d-flex flex-column gap-4">
        <div *ngFor="let s of snapshots" class="card p-4 bg-body-tertiary border">
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 border-bottom pb-2">
            <div>
              <div class="h5 m-0 text-primary">{{ s.snapshot_id }}</div>
              <div class="small text-muted">Captured at Block Height {{ s.block_height | number }} &bull; {{ s.timestamp_utc }}</div>
            </div>
            <div class="d-flex gap-2">
              <span class="badge bg-success">{{ s.v2_percentage }}% BIP324 v2</span>
              <span class="badge bg-info">{{ s.total_nodes | number }} Reachable Nodes</span>
            </div>
          </div>

          <div class="row g-4">
            <!-- Top ASNs -->
            <div class="col-12 col-md-4">
              <h2 class="h6 mb-2">Hosting ASNs</h2>
              <ul class="list-group list-group-sm">
                <li *ngFor="let asn of s.top_asns" class="list-group-item d-flex justify-content-between align-items-center bg-transparent px-2">
                  <span class="small">{{ asn.org }} (AS{{ asn.asn }})</span>
                  <span class="badge bg-secondary rounded-pill">{{ asn.count | number }}</span>
                </li>
              </ul>
            </div>

            <!-- Top Clients -->
            <div class="col-12 col-md-4">
              <h2 class="h6 mb-2">Top Client Implementations</h2>
              <ul class="list-group list-group-sm">
                <li *ngFor="let c of s.top_clients" class="list-group-item d-flex justify-content-between align-items-center bg-transparent px-2">
                  <code class="small">{{ c.client }}</code>
                  <span class="badge bg-secondary rounded-pill">{{ c.count | number }}</span>
                </li>
              </ul>
            </div>

            <!-- Geographic Spread -->
            <div class="col-12 col-md-4">
              <h2 class="h6 mb-2">Top Jurisdictions</h2>
              <ul class="list-group list-group-sm">
                <li *ngFor="let g of s.geo_distribution" class="list-group-item d-flex justify-content-between align-items-center bg-transparent px-2">
                  <span class="small">Country {{ g.country }}</span>
                  <span class="badge bg-secondary rounded-pill">{{ g.count | number }}</span>
                </li>
              </ul>
            </div>
          </div>
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
export class GlobalNetworkSnapshotsComponent implements OnInit, OnDestroy {
  snapshots: GlobalNetworkSnapshot[] = [];
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: GlobalNetworkApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getSnapshots$().subscribe({
        next: data => {
          this.snapshots = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load snapshots';
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
