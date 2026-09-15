import { blockspaceValue, blockspaceShare, blockspaceBtc } from './blockspace-format';
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BlockspaceApiService, BlockspaceOverview } from './blockspace.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-blockspace-overview',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Blockspace Semantics</h1>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Composition, demand regimes and transaction classes, from observed blocks.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" [routerLink]="'/intelligence/blockspace' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/intelligence/blockspace/composition' | relativeUrl">Composition</a>
          <a class="nav-link" [routerLink]="'/intelligence/blockspace/regimes' | relativeUrl">Fee Regimes</a>
          <a class="nav-link" [routerLink]="'/intelligence/blockspace/compare' | relativeUrl">Regime Compare</a>
          <a class="nav-link" [routerLink]="'/intelligence/blockspace/taxonomy' | relativeUrl">Taxonomy Catalog</a>
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
              <div class="h5 my-1 text-primary text-uppercase">{{ overview.current_regime ? overview.current_regime.regime_type.replace('_', ' ') : 'not yet observed' }}</div>
              <div class="small text-muted">{{ overview.current_regime ? 'Height ' + overview.current_regime.start_height + ' to present' : 'Needs a block with a median fee rate' }}</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Median of Observed Block Medians</div>
              <div class="h4 my-1 text-success">{{ value(overview.median_feerate_24h, 'sat/vB') }}</div>
              <div class="small text-muted">{{ overview.window?.covers_24h === true ? 'Linked observed blocks span 24 hours relative to the observed tip timestamp' : overview.window?.covers_24h === null ? 'Full window coverage is unknown' : 'Partial observed window' }}. Blocks {{ overview.window?.from_height }}–{{ overview.window?.to_height }}. Observed {{ overview.last_updated | date:'medium' }}.</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Observed Fee Band</div>
              <div class="h6 my-1 text-info">
                {{ overview.current_regime?.primary_demand_driver || 'not yet observed' }}
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
          <h2 class="h5 mb-3">Observed Blockspace Consumption</h2>
          <div class="table-responsive" tabindex="0" role="region" aria-label="Observed Blockspace Consumption, scroll horizontally" i18n-aria-label>
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Class Name</th>
                  <th>Category</th>
                  <th class="text-end">Weight Share</th>
                  <th class="text-end">Fee Share</th>
                  <th class="text-end">Observed Tx Count</th>
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
                  <td class="text-end fw-semibold">{{ value(c.weight_share_percentage, '%') }}</td>
                  <td class="text-end fw-semibold">{{ value(c.fee_share_percentage, '%') }}</td>
                  <td class="text-end text-muted">{{ c.tx_count_24h | number }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Recent Composition Blocks -->
        <section class="card p-4 bg-body-tertiary border">
          <h2 class="h5 mb-3">Recent Block Composition</h2>
          <div class="table-responsive" tabindex="0" role="region" aria-label="Recent Block Composition, scroll horizontally" i18n-aria-label>
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
                  <td class="text-end">{{ value(p.total_weight, 'WU') }}</td>
                  <td class="text-end">{{ btc(p.total_fee_sats) }}</td>
                  <td class="text-end">{{ share(p.monetary_weight, p.total_weight) }}</td>
                  <td class="text-end">{{ share(p.arbitrary_data_weight, p.total_weight) }}</td>
                  <td class="text-end">{{ share(p.layer2_weight, p.total_weight) }}</td>
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

  readonly value = blockspaceValue;
  readonly share = blockspaceShare;
  readonly btc = blockspaceBtc;

  public ngOnInit(): void {
    this.sub?.unsubscribe();
    this.sub = this.blockspaceApi.watch(() => this.blockspaceApi.getOverview()).subscribe(state => {
      this.overview = state.kind === 'ready' ? state.data : null;
      this.loading = state.kind === 'loading';
      this.error = state.kind === 'error' ? state.error : '';
      this.cd.markForCheck();
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
