import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { GlobalNetworkApiService, GlobalNetworkDnsSeed } from './global-network.service';

@Component({
  selector: 'app-global-network-seeds',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Bitcoin DNS Seed Observatory</h1>
          <span class="badge bg-secondary" *ngIf="seeds.length > 0">
            {{ seeds.length }} Seed Hosts Monitored
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Status, address pool size, and reachability ratios of authoritative DNS seeds used for initial peer discovery.
        </p>

        <!-- Sub-navigation tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/network/global">Overview</a>
          <a class="nav-link" routerLink="/network/global/nodes">Reachable Nodes</a>
          <a class="nav-link" routerLink="/network/global/snapshots">Snapshots Archive</a>
          <a class="nav-link active" routerLink="/network/global/seeds">DNS Seeds</a>
          <a class="nav-link" routerLink="/network/global/self-check">Node Self-Check</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Querying DNS seed infrastructure...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && seeds.length > 0" class="card bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Seed Hostname</th>
                <th>Maintainer</th>
                <th>Status</th>
                <th>Discovered Peers</th>
                <th>Reachable Ratio</th>
                <th class="text-end">Last Query (UTC)</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of seeds">
                <td><code class="fw-bold">{{ s.hostname }}</code></td>
                <td>{{ s.maintainer }}</td>
                <td>
                  <span class="badge bg-success" *ngIf="s.active">Active</span>
                  <span class="badge bg-warning" *ngIf="!s.active">Inactive</span>
                </td>
                <td class="fw-semibold">{{ s.discovered_addrs_count | number }}</td>
                <td>
                  <div class="d-flex align-items-center gap-2">
                    <div class="progress flex-grow-1" style="height: 6px; min-width: 60px;">
                      <div class="progress-bar bg-success" [style.width.%]="s.reachable_ratio * 100"></div>
                    </div>
                    <span class="small">{{ (s.reachable_ratio * 100).toFixed(1) }}%</span>
                  </div>
                </td>
                <td class="text-end text-muted small">{{ s.last_query_at }}</td>
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
export class GlobalNetworkSeedsComponent implements OnInit, OnDestroy {
  seeds: GlobalNetworkDnsSeed[] = [];
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: GlobalNetworkApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getDnsSeeds$().subscribe({
        next: data => {
          this.seeds = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load DNS seeds';
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
