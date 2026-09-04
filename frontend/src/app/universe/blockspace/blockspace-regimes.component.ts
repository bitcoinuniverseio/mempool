import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BlockspaceApiService, BlockspaceRegimeEvent } from './blockspace.service';

@Component({
  selector: 'app-blockspace-regimes',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Fee and Demand Regimes</h1>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Historical periods of distinct fee dynamics, network congestion, and protocol demand drivers detected across block history.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/intelligence/blockspace">Overview</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/composition">Composition</a>
          <a class="nav-link active" routerLink="/intelligence/blockspace/regimes">Fee Regimes</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/compare">Regime Compare</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/taxonomy">Taxonomy Catalog</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Detecting blockspace demand regimes...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && regimes.length > 0" class="content-body">
        <section class="card p-4 bg-body-tertiary border mb-4">
          <h2 class="h5 mb-3">Detected Regime History</h2>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Regime Type</th>
                  <th>Height Range</th>
                  <th class="text-end">Median Feerate</th>
                  <th>Primary Demand Driver</th>
                  <th>Detection Time</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let r of regimes">
                  <td>
                    <span class="badge" [ngClass]="{
                      'bg-success': r.regime_type === 'consolidation_friendly',
                      'bg-primary': r.regime_type === 'monetary_standard',
                      'bg-warning text-dark': r.regime_type === 'data_minting_spike',
                      'bg-danger': r.regime_type === 'extreme_congestion'
                    }">
                      {{ r.regime_type.replace('_', ' ') }}
                    </span>
                  </td>
                  <td>
                    <span class="fw-semibold">{{ r.start_height }}</span>
                    <span class="text-muted"> to </span>
                    <span class="fw-semibold">{{ r.end_height ? r.end_height : 'Present' }}</span>
                  </td>
                  <td class="text-end fw-bold">{{ r.median_feerate }} sat/vB</td>
                  <td>{{ r.primary_demand_driver }}</td>
                  <td class="text-muted small">{{ r.detected_at | date:'medium' }}</td>
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
export class BlockspaceRegimesComponent implements OnInit, OnDestroy {
  public regimes: BlockspaceRegimeEvent[] = [];
  public loading = true;
  public error = '';

  private sub?: Subscription;

  constructor(
    private blockspaceApi: BlockspaceApiService,
    private cd: ChangeDetectorRef,
  ) {}

  public ngOnInit(): void {
    this.sub = this.blockspaceApi.getRegimes().subscribe({
      next: (data) => {
        this.regimes = data;
        this.loading = false;
        this.cd.markForCheck();
      },
      error: (err) => {
        this.error = err?.message || 'Failed to load regimes';
        this.loading = false;
        this.cd.markForCheck();
      },
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
