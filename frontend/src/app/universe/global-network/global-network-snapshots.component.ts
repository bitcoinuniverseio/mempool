import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, Subject } from 'rxjs';
import { GlobalNetworkApiService, GlobalNetworkSnapshot, GlobalNetworkSnapshotsReport } from './global-network.service';
import { StateService } from '@app/services/state.service';
import { globalRead$ } from './global-network-observations';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-global-network-snapshots',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Peer history</h1>
          <span class="badge bg-secondary" *ngIf="snapshots.length > 0">
            {{ snapshots.length }} Archives Available
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Saved observations of our node's connections, with the original network shown on each record.
        </p>

        <!-- Sub-navigation tabs -->
        <nav aria-label="Peer navigation" class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/network/global' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/network/global/nodes' | relativeUrl">Peers</a>
          <a class="nav-link active" aria-current="page" [routerLink]="'/network/global/snapshots' | relativeUrl">History</a>
          <a class="nav-link" [routerLink]="'/network/global/seeds' | relativeUrl">Discovery</a>
          <a class="nav-link" [routerLink]="'/network/global/self-check' | relativeUrl">Connection check</a>
        </nav>
      </header>

      <p *ngIf="report" role="status" class="text-muted">{{ report.configured_network | titlecase }} &bull; {{ snapshots.length }} saved observations</p>
      <details *ngIf="report" class="mb-3">
        <summary>Source details</summary>
        <p class="small text-muted">Configured network {{ report.configured_network }}. {{ report.scope }}.
          This configured selection does not attest an independently observed node identity.</p>
      </details>
      <p *ngIf="!loading && report && !snapshots.length">No observations have been saved yet.</p>
      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading saved observations...</div>
      </div>

      <button type="button" class="btn btn-outline-primary mb-3" (click)="retry()" [disabled]="loading">{{ error ? 'Retry' : 'Refresh' }}</button>
      <div *ngIf="error" role="alert" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && snapshots.length > 0" class="d-flex flex-column gap-4">
        <div *ngFor="let s of snapshots" class="card p-4 bg-body-tertiary border">
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 border-bottom pb-2">
            <div>
              <div class="h5 m-0 text-primary">{{ s.snapshot_id }}</div>
              <div class="small text-muted">{{ s.network }} &bull; {{ s.scope }}<br>Captured at Block Height {{ s.block_height | number }} &bull; {{ s.timestamp_utc }}</div>
            </div>
            <div class="d-flex gap-2">
              <span class="badge bg-success">{{ s.v2_percentage === null ? 'Unknown' : s.v2_percentage + '%' }} BIP324 v2</span>
              <span class="badge bg-info">{{ s.total_nodes | number }} Reachable Nodes</span>
            </div>
          </div>

          <div class="row g-4">
            <!-- Top ASNs -->
            <div class="col-12 col-md-4">
              <h2 class="h6 mb-2">Hosting ASNs</h2>
              <ul class="list-group list-group-sm">
                <li *ngIf="!s.top_asns.length" class="list-group-item bg-transparent text-muted px-2">Not reported</li>
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
                <li *ngIf="!s.top_clients.length" class="list-group-item bg-transparent text-muted px-2">Not reported</li>
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
                <li *ngIf="!s.geo_distribution.length" class="list-group-item bg-transparent text-muted px-2">No location data</li>
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
      background-color: var(--u-brand);
      color: var(--u-brand-contrast);
    }
  `],
})
export class GlobalNetworkSnapshotsComponent implements OnInit, OnDestroy {
  snapshots: GlobalNetworkSnapshot[] = [];
  report: GlobalNetworkSnapshotsReport | null = null;
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
    this.sub.add(globalRead$(this.state, this.retrySignal, () => this.api.getSnapshots$()).subscribe(result => {
      this.report = result.value; this.snapshots = result.value?.snapshots ?? [];
      this.loading = result.kind === 'loading'; this.error = result.error; this.cd.markForCheck();
    }));
  }
  retry(): void { this.retrySignal.next(); }
  ngOnDestroy(): void { this.sub.unsubscribe(); this.retrySignal.complete(); }
}
