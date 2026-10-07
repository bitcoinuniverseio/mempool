import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, Subject } from 'rxjs';
import { GlobalNetworkApiService, GlobalNetworkDnsSeed, GlobalNetworkDnsReport } from './global-network.service';
import { StateService } from '@app/services/state.service';
import { globalRead$ } from './global-network-observations';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-global-network-seeds',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Peer discovery</h1>
          <span class="badge bg-secondary" *ngIf="seeds.length > 0">
            {{ seeds.length }} Seed Hosts Monitored
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Starting points for finding peers. Discovered addresses are not checked.
        </p>

        <!-- Sub-navigation tabs -->
        <nav aria-label="Peer navigation" class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/network/global' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/network/global/nodes' | relativeUrl">Peers</a>
          <a class="nav-link" [routerLink]="'/network/global/snapshots' | relativeUrl">History</a>
          <a class="nav-link active" aria-current="page" [routerLink]="'/network/global/seeds' | relativeUrl">Discovery</a>
          <a class="nav-link" [routerLink]="'/network/global/self-check' | relativeUrl">Connection check</a>
        </nav>
      </header>

      <p *ngIf="report" role="status" class="text-muted">{{ report.configured_network | titlecase }} &bull; {{ seeds.length }} discovery sources</p>
      <details *ngIf="report" class="mb-3">
        <summary>Source details</summary>
        <p class="small text-muted">Configured network {{ report.configured_network }}. {{ report.scope }}.
          This configured selection does not attest an independently observed node identity.</p>
      </details>
      <p *ngIf="!loading && report && !seeds.length">No discovery sources are available for this network.</p>
      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading discovery sources...</div>
      </div>

      <button type="button" class="btn btn-outline-primary mb-3" (click)="retry()" [disabled]="loading">{{ error ? 'Retry' : 'Refresh' }}</button>
      <div *ngIf="error" role="alert" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && seeds.length > 0" class="card bg-body-tertiary border">
        <div class="table-responsive" tabindex="0" role="region" aria-label="Bitcoin DNS Seed Observatory, scroll horizontally" i18n-aria-label>
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
                  <span class="badge bg-success" *ngIf="s.active === true">Active</span><span *ngIf="s.active === null" class="badge bg-secondary">Unknown</span>
                  <span class="badge bg-warning" *ngIf="s.active === false">Inactive</span>
                </td>
                <td class="fw-semibold">{{ s.discovered_addrs_count === null ? 'Unknown' : (s.discovered_addrs_count | number) }}</td>
                <td>
                  <div class="d-flex align-items-center gap-2" *ngIf="s.reachable_ratio !== null">
                    <div class="progress flex-grow-1" style="height: 6px; min-width: 60px;">
                      <div class="progress-bar bg-success" [style.width.%]="s.reachable_ratio * 100"></div>
                    </div>
                    <span class="small">{{ (s.reachable_ratio * 100).toFixed(1) }}%</span>
                  </div>
                  <span class="small text-muted" *ngIf="s.reachable_ratio === null">not probed</span>
                  <span class="small text-danger d-block" *ngIf="s.error">{{ s.error }}</span>
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
      background-color: var(--u-brand);
      color: var(--u-brand-contrast);
    }
  `],
})
export class GlobalNetworkSeedsComponent implements OnInit, OnDestroy {
  seeds: GlobalNetworkDnsSeed[] = [];
  report: GlobalNetworkDnsReport | null = null;
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
    this.sub.add(globalRead$(this.state, this.retrySignal, () => this.api.getDnsSeeds$()).subscribe(result => {
      this.report = result.value; this.seeds = result.value?.seeds ?? [];
      this.loading = result.kind === 'loading'; this.error = result.error; this.cd.markForCheck();
    }));
  }
  retry(): void { this.retrySignal.next(); }
  ngOnDestroy(): void { this.sub.unsubscribe(); this.retrySignal.complete(); }
}
