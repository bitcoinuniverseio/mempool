import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BlockspaceApiService, BlockspaceOverview } from './blockspace.service';

@Component({
  selector: 'app-blockspace-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Blockspace Demand and Transaction Semantics Terminal</h1>
          <span class="badge bg-primary" *ngIf="overview">
            Median Feerate: {{ overview.median_feerate_24h }} sat/vB
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Deep structural analysis of Bitcoin blockspace composition, demand regimes, script taxonomy, and transaction intent classification.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/intelligence/blockspace">Overview</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/composition">Composition</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/regimes">Fee Regimes</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/compare">Regime Compare</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/taxonomy">Taxonomy Catalog</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Aggregating blockspace demand and transaction semantics...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="content-body">
        <!-- Metric Cards -->
        <section class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Current Regime</div>
              <div class="h5 my-1 text-primary text-uppercase">{{ overview.current_regime.regime_type.replace('_', ' ') }}</div>
              <div class="small text-muted">Height {{ overview.current_regime.start_height }} to present</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Median Feerate (24h)</div>
              <div class="h4 my-1 text-success">{{ overview.median_feerate_24h }} sat/vB</div>
              <div class="small text-muted">Rolling 24-hour window</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Primary Demand Driver</div>
              <div class="h6 my-1 text-info text-truncate" [title]="overview.current_regime.primary_demand_driver">
                {{ overview.current_regime.primary_demand_driver }}
              </div>
              <div class="small text-muted">Identified from block evidence</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Taxonomy Classes</div>
              <div class="h4 my-1 text-warning">{{ overview.taxonomy_classes.length }} Categories</div>
              <div class="small text-muted">Active classification tree</div>
            </div>
          </div>
        </section>

        <!-- Semantic Classes Breakdown -->
        <section class="card p-4 bg-body-tertiary border mb-4">
          <h2 class="h5 mb-3">Semantic Blockspace Consumption (24h)</h2>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Class Name</th>
                  <th>Category</th>
                  <th class="text-end">Weight Share</th>
                  <th class="text-end">Fee Share</th>
                  <th class="text-end">24h Tx Count</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let c of overview.taxonomy_classes">
                  <td>
                    <div class="fw-bold">{{ c.name }}</div>
                    <div class="small text-muted">{{ c.description }}</div>
                  </td>
                  <td>
                    <span class="badge" [ngClass]="{
                      'bg-success': c.category === 'monetary',
                      'bg-info': c.category === 'layer2',
                      'bg-warning text-dark': c.category === 'arbitrary_data',
                      'bg-secondary': c.category === 'infrastructure'
                    }">
                      {{ c.category }}
                    </span>
                  </td>
                  <td class="text-end fw-semibold">{{ c.weight_share_percentage }}%</td>
                  <td class="text-end fw-semibold">{{ c.fee_share_percentage }}%</td>
                  <td class="text-end text-muted">{{ c.tx_count_24h | number }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Recent Composition Blocks -->
        <section class="card p-4 bg-body-tertiary border">
          <h2 class="h5 mb-3">Recent Block Composition</h2>
          <div class="table-responsive">
            <table class="table table-sm table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Block Height</th>
                  <th>Timestamp</th>
                  <th class="text-end">Total Weight</th>
                  <th class="text-end">Total Fees</th>
                  <th class="text-end">Monetary Weight</th>
                  <th class="text-end">Data Weight</th>
                  <th class="text-end">L2 Weight</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let p of overview.composition_timeseries">
                  <td class="fw-bold">{{ p.block_height }}</td>
                  <td class="text-muted small">{{ p.timestamp_utc | date:'short' }}</td>
                  <td class="text-end">{{ p.total_weight | number }} WU</td>
                  <td class="text-end">{{ (p.total_fee_sats / 100000000).toFixed(4) }} BTC</td>
                  <td class="text-end">{{ ((p.monetary_weight / p.total_weight) * 100).toFixed(1) }}%</td>
                  <td class="text-end">{{ ((p.arbitrary_data_weight / p.total_weight) * 100).toFixed(1) }}%</td>
                  <td class="text-end">{{ ((p.layer2_weight / p.total_weight) * 100).toFixed(1) }}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .intelligence-page {
      padding: 1.5rem 1rem 3rem;
    }
  `]
})
export class BlockspaceOverviewComponent implements OnInit, OnDestroy {
  public overview: BlockspaceOverview | null = null;
  public loading = true;
  public error = '';

  private sub?: Subscription;

  constructor(
    private blockspaceApi: BlockspaceApiService,
    private cd: ChangeDetectorRef,
  ) {}

  public ngOnInit(): void {
    this.sub = this.blockspaceApi.getOverview().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cd.markForCheck();
      },
      error: (err) => {
        this.error = err?.message || 'Failed to load blockspace overview';
        this.loading = false;
        this.cd.markForCheck();
      },
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
