import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { QuantumApiService, QuantumOverview } from './quantum.service';

@Component({
  selector: 'app-quantum-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Quantum Exposure and Migration Readiness Center</h1>
          <span class="badge bg-warning text-dark" *ngIf="overview">
            {{ overview.exposed_supply_percentage }}% Supply Exposed
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Analysis of public key exposure risk, unspent transaction output vulnerability classes, and noncustodial migration readiness.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/intelligence/quantum">Overview</a>
          <a class="nav-link" routerLink="/intelligence/quantum/exposure">Script Cohorts</a>
          <a class="nav-link" routerLink="/intelligence/quantum/history">Reveal Timeline</a>
          <a class="nav-link" routerLink="/intelligence/quantum/audit">Local Public Audit</a>
          <a class="nav-link" routerLink="/intelligence/quantum/migration">Migration Planner</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Calculating UTXO quantum vulnerability profile...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="content-body">
        <!-- Metric Cards -->
        <section class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Total UTXOs in Set</div>
              <div class="h4 my-1 text-primary">{{ overview.total_utxo_count | number }}</div>
              <div class="small text-muted">Complete chain set</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Exposed Public Keys</div>
              <div class="h4 my-1 text-danger">{{ overview.exposed_utxo_count | number }} UTXOs</div>
              <div class="small text-muted">Vulnerable to Shor's algorithm</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Exposed Supply</div>
              <div class="h4 my-1 text-warning">{{ (overview.exposed_sats / 100000000).toFixed(2) | number }} BTC</div>
              <div class="small text-muted">{{ overview.exposed_supply_percentage }}% of total circulating</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Hash-Protected Supply</div>
              <div class="h4 my-1 text-success">{{ (100 - overview.exposed_supply_percentage).toFixed(2) }}%</div>
              <div class="small text-muted">Protected by SHA256 & RIPEMD160</div>
            </div>
          </div>
        </section>

        <!-- Cohorts Breakdown Table -->
        <section class="card p-4 bg-body-tertiary border mb-4">
          <h2 class="h5 mb-3">Vulnerability Exposure by Script Standard</h2>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Script Standard</th>
                  <th class="text-end">Total UTXOs</th>
                  <th class="text-end">Exposed UTXOs</th>
                  <th class="text-end">Exposed BTC</th>
                  <th class="text-end">Exposure Ratio</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let c of overview.cohorts">
                  <td class="fw-bold">{{ c.script_type }}</td>
                  <td class="text-end">{{ c.total_utxos | number }}</td>
                  <td class="text-end">{{ c.exposed_utxos | number }}</td>
                  <td class="text-end fw-semibold">{{ (c.exposed_sats / 100000000).toFixed(2) | number }} BTC</td>
                  <td class="text-end">
                    <span class="badge" [ngClass]="c.exposed_percentage > 50 ? 'bg-danger' : c.exposed_percentage > 0 ? 'bg-warning text-dark' : 'bg-success'">
                      {{ c.exposed_percentage.toFixed(1) }}%
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
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
export class QuantumOverviewComponent implements OnInit, OnDestroy {
  overview: QuantumOverview | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: QuantumApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getOverview$().subscribe({
        next: data => {
          this.overview = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load quantum overview';
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
