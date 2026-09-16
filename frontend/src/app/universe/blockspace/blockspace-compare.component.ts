import { blockspaceValue, blockspaceShare, blockspaceBtc } from './blockspace-format';
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BlockspaceApiService, BlockspaceRegimeEvent } from './blockspace.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-blockspace-compare',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Regime Differential Analysis</h1>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Compare observed block median fee bands. Demand attribution, fee distributions and witness utilization require additional evidence.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/intelligence/blockspace' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/intelligence/blockspace/composition' | relativeUrl">Composition</a>
          <a class="nav-link" [routerLink]="'/intelligence/blockspace/regimes' | relativeUrl">Fee Regimes</a>
          <a class="nav-link active" [routerLink]="'/intelligence/blockspace/compare' | relativeUrl">Regime Compare</a>
          <a class="nav-link" [routerLink]="'/intelligence/blockspace/taxonomy' | relativeUrl">Taxonomy Catalog</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading comparative regime models...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && regimes.length >= 2" class="content-body">
        <div class="row g-4 mb-4">
          <!-- Regime A -->
          <div class="col-12 col-md-6">
            <div class="card p-4 bg-body-tertiary border h-100">
              <span class="badge bg-secondary mb-2 align-self-start">Reference Regime A</span>
              <h2 class="h5">{{ regimes[0].regime_type.replace('_', ' ') | uppercase }}</h2>
              <div class="text-muted small mb-3">Height {{ regimes[0].start_height }} to {{ regimes[0].end_height ?? 'Present' }}</div>

              <div class="d-flex justify-content-between py-2 border-bottom">
                <span class="text-muted">Median of Block Medians</span>
                <span class="fw-bold">{{ regimes[0].median_feerate }} sat/vB</span>
              </div>
              <div class="d-flex justify-content-between py-2 border-bottom">
                <span class="text-muted">Observed Fee Band</span>
                <span class="fw-semibold text-end">{{ regimes[0].primary_demand_driver }}</span>
              </div>
              <div class="d-flex justify-content-between py-2">
                <span class="text-muted">Network</span>
                <span class="fw-semibold text-capitalize">{{ regimes[0].network }}</span>
              </div>
            </div>
          </div>

          <!-- Regime B -->
          <div class="col-12 col-md-6">
            <div class="card p-4 bg-body-tertiary border h-100">
              <span class="badge bg-secondary mb-2 align-self-start">Comparison Regime B</span>
              <h2 class="h5">{{ regimes[1].regime_type.replace('_', ' ') | uppercase }}</h2>
              <div class="text-muted small mb-3">Height {{ regimes[1].start_height }} to {{ regimes[1].end_height ?? 'Present' }}</div>

              <div class="d-flex justify-content-between py-2 border-bottom">
                <span class="text-muted">Median of Block Medians</span>
                <span class="fw-bold">{{ regimes[1].median_feerate }} sat/vB</span>
              </div>
              <div class="d-flex justify-content-between py-2 border-bottom">
                <span class="text-muted">Observed Fee Band</span>
                <span class="fw-semibold text-end">{{ regimes[1].primary_demand_driver }}</span>
              </div>
              <div class="d-flex justify-content-between py-2">
                <span class="text-muted">Network</span>
                <span class="fw-semibold text-capitalize">{{ regimes[1].network }}</span>
              </div>
            </div>
          </div>
        </div>

        <section class="card p-4 bg-body-tertiary border">
          <h2 class="h5 mb-3">Structural Divergence Summary</h2>
          <p class="text-muted mb-0">
            These fee bands compare medians of observed block medians. The cause of demand, fee distributions and witness utilization are not established by this comparison.
          </p>
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
export class BlockspaceCompareComponent implements OnInit, OnDestroy {
  public regimes: BlockspaceRegimeEvent[] = [];
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
    this.sub = this.blockspaceApi.watch(() => this.blockspaceApi.getRegimes()).subscribe(state => {
      this.regimes = state.kind === 'ready' ? state.data : [];
      this.loading = state.kind === 'loading';
      this.error = state.kind === 'error' ? state.error : '';
      this.cd.markForCheck();
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
