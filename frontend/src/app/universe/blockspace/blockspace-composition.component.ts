import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BlockspaceApiService, BlockspaceCompositionPoint } from './blockspace.service';

@Component({
  selector: 'app-blockspace-composition',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Blockspace Composition Timeseries</h1>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Historical breakdown of block weight and fee density allocated to monetary, layer 2, consolidation, and arbitrary data payloads.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/intelligence/blockspace">Overview</a>
          <a class="nav-link active" routerLink="/intelligence/blockspace/composition">Composition</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/regimes">Fee Regimes</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/compare">Regime Compare</a>
          <a class="nav-link" routerLink="/intelligence/blockspace/taxonomy">Taxonomy Catalog</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading blockspace timeseries composition points...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && composition.length > 0" class="content-body">
        <section class="card p-4 bg-body-tertiary border mb-4">
          <h2 class="h5 mb-3">Historical Block Breakdown</h2>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Height</th>
                  <th>Timestamp</th>
                  <th class="text-end">Total Weight</th>
                  <th class="text-end">Total Fees</th>
                  <th class="text-end">Monetary</th>
                  <th class="text-end">Arbitrary Data</th>
                  <th class="text-end">Consolidations</th>
                  <th class="text-end">Layer 2</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let point of composition">
                  <td class="fw-bold">{{ point.block_height }}</td>
                  <td class="text-muted small">{{ point.timestamp_utc | date:'medium' }}</td>
                  <td class="text-end">{{ point.total_weight | number }} WU</td>
                  <td class="text-end fw-semibold">{{ (point.total_fee_sats / 100000000).toFixed(4) }} BTC</td>
                  <td class="text-end text-success">{{ ((point.monetary_weight / point.total_weight) * 100).toFixed(1) }}%</td>
                  <td class="text-end text-warning">{{ ((point.arbitrary_data_weight / point.total_weight) * 100).toFixed(1) }}%</td>
                  <td class="text-end text-secondary">{{ ((point.consolidation_weight / point.total_weight) * 100).toFixed(1) }}%</td>
                  <td class="text-end text-info">{{ ((point.layer2_weight / point.total_weight) * 100).toFixed(1) }}%</td>
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
export class BlockspaceCompositionComponent implements OnInit, OnDestroy {
  public composition: BlockspaceCompositionPoint[] = [];
  public loading = true;
  public error = '';

  private sub?: Subscription;

  constructor(
    private blockspaceApi: BlockspaceApiService,
    private cd: ChangeDetectorRef,
  ) {}

  public ngOnInit(): void {
    this.sub = this.blockspaceApi.getComposition(48).subscribe({
      next: (data) => {
        this.composition = data;
        this.loading = false;
        this.cd.markForCheck();
      },
      error: (err) => {
        this.error = err?.message || 'Failed to load composition timeseries';
        this.loading = false;
        this.cd.markForCheck();
      },
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
