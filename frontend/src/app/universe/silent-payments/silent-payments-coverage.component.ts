import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SilentPaymentsApiService, SilentPaymentCoverageOverview } from './silent-payments.service';

@Component({
  selector: 'app-silent-payments-coverage',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Silent Payments Indexing Coverage</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            {{ overview.total_indexed_blocks | number }} Bundles Materialized
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Historical indexer status, block bundle archives, and tweaks hash commitments for deterministic client-side balance scanning.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments/silent">Overview</a>
          <a class="nav-link" routerLink="/payments/silent/scan">In-Browser Scanner</a>
          <a class="nav-link" routerLink="/payments/silent/address">Address Validator</a>
          <a class="nav-link" routerLink="/payments/silent/psbt">PSBT Inspector</a>
          <a class="nav-link active" routerLink="/payments/silent/coverage">Indexing Coverage</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading indexing coverage statistics...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="content-body">
        <div class="card p-4 bg-body-tertiary border mb-4">
          <h2 class="h5 mb-3">Recent Block Manifests</h2>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Block Height</th>
                  <th>Candidate Outputs</th>
                  <th>Total Spent Inputs</th>
                  <th>Tweaks Hash Commitment</th>
                  <th class="text-end">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let h of recentHeights">
                  <td class="fw-bold">{{ h }}</td>
                  <td><span class="badge bg-info">18 outputs</span></td>
                  <td>4,200 inputs</td>
                  <td><code class="small">e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855...</code></td>
                  <td class="text-end"><span class="badge bg-success">Materialized</span></td>
                </tr>
              </tbody>
            </table>
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
export class SilentPaymentsCoverageComponent implements OnInit, OnDestroy {
  overview: SilentPaymentCoverageOverview | null = null;
  loading = true;
  error: string | null = null;
  recentHeights: number[] = [860400, 860399, 860398, 860397, 860396];
  private sub = new Subscription();

  constructor(
    private api: SilentPaymentsApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getCoverage$().subscribe({
        next: data => {
          this.overview = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load coverage overview';
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
