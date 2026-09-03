import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-time-machine',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Historical Mempool Time Machine</h1>
          <span class="badge badge-primary">Event-Sourced Replay</span>
        </div>
        <p class="subtitle">
          Reconstruct exact historical mempool state at any past block height or timestamp with deterministic state hashes and explicit gap accounting.
        </p>
      </header>

      <!-- Coverage Indicator -->
      <div *ngIf="coverage" class="alert alert-info d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
        <div>
          <strong>Archival Coverage:</strong>
          <span> From {{ coverage.earliest_recorded_event_utc | date:'mediumDate' }} to {{ coverage.latest_recorded_event_utc | date:'mediumDate' }}</span>
          <span class="badge badge-secondary ms-2">{{ coverage.total_checkpoints }} verified checkpoints</span>
        </div>
        <div *ngIf="coverage.coverage_gaps.length > 0" class="small text-warning">
          ⚠ {{ coverage.coverage_gaps.length }} documented maintenance intervals
        </div>
      </div>

      <!-- Scrub Controls -->
      <section class="card mb-4">
        <div class="card-header">
          <h4 class="mb-0">Replay Target</h4>
        </div>
        <div class="card-body">
          <div class="row g-3 align-items-end">
            <div class="col-md-5">
              <label class="form-label small text-muted">Target Block Height</label>
              <input
                type="number"
                class="form-control font-monospace"
                [(ngModel)]="targetHeight"
                placeholder="e.g. 860020"
              />
            </div>
            <div class="col-md-4">
              <label class="form-label small text-muted">Or Target ISO Timestamp</label>
              <input
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="targetTimestamp"
                placeholder="2026-08-20T12:00:00Z"
              />
            </div>
            <div class="col-md-3">
              <button class="btn btn-primary w-100" [disabled]="loading" (click)="runReplay()">
                {{ loading ? 'Replaying Events...' : 'Replay Mempool State' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Reconstructed State View -->
      <section *ngIf="currentState" class="results-section">
        <div class="card mb-4 border-primary">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <span class="badge badge-primary">STATE RECONSTRUCTED</span>
              <h4 class="mt-1 mb-0 font-monospace">{{ currentState.state_hash }}</h4>
            </div>
            <div class="btn-group">
              <button class="btn btn-sm btn-outline-secondary" (click)="export('json')">Export JSON</button>
              <button class="btn btn-sm btn-outline-secondary" (click)="export('parquet')">Export Parquet</button>
            </div>
          </div>
          <div class="card-body">
            <div class="row text-center g-3 mb-4">
              <div class="col-md-3 col-6">
                <div class="p-3 rounded bg-dark-subtle">
                  <div class="small text-muted">Mempool Transactions</div>
                  <div class="h3 my-1">{{ currentState.total_transactions | number }}</div>
                  <div class="small text-muted">Height {{ currentState.target_block_height }}</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-3 rounded bg-dark-subtle">
                  <div class="small text-muted">Total Mempool Weight</div>
                  <div class="h3 my-1 text-primary">{{ (currentState.total_weight / 4000000).toFixed(2) }} MvB</div>
                  <div class="small text-muted">{{ currentState.projected_blocks_count }} projected blocks</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-3 rounded bg-dark-subtle">
                  <div class="small text-muted">Total Unconfirmed Fees</div>
                  <div class="h3 my-1">{{ (currentState.total_fees_sats / 100000000).toFixed(4) }} BTC</div>
                  <div class="small text-muted">{{ currentState.total_fees_sats | number }} sats</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-3 rounded bg-dark-subtle">
                  <div class="small text-muted">Median Feerate</div>
                  <div class="h3 my-1 text-success">{{ currentState.median_feerate_sats_vb }} sat/vB</div>
                  <div class="small text-muted">At checkpoint {{ currentState.nearest_checkpoint_id }}</div>
                </div>
              </div>
            </div>

            <!-- Historical Fee Histogram -->
            <h5 class="mb-3">Fee Rate Histogram At State</h5>
            <div class="table-responsive">
              <table class="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th>Feerate Band</th>
                    <th>Transaction Count</th>
                    <th>Virtual Size</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let bucket of currentState.fee_distribution">
                    <td class="fw-bold">{{ bucket.feerate_bucket }}</td>
                    <td>{{ bucket.count | number }}</td>
                    <td class="font-monospace">{{ bucket.total_vsize | number }} vB</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .intelligence-page { padding-top: 2rem; padding-bottom: 4rem; }
    .page-header { margin-bottom: 2rem; }
    .title-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .badge {
      display: inline-block; padding: 0.35em 0.65em; font-size: 0.75em;
      font-weight: 700; line-height: 1; text-align: center; white-space: nowrap;
      vertical-align: baseline; border-radius: 0.25rem;
    }
    .badge-primary { background-color: #0d6efd; color: #fff; }
    .badge-secondary { background-color: #6c757d; color: #fff; }
  `],
})
export class TimeMachineComponent implements OnInit {
  coverage: any = null;
  currentState: any = null;
  targetHeight = 860020;
  targetTimestamp = '';
  loading = false;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.getTimeMachineCoverage$().subscribe((res) => {
      this.coverage = res;
      this.cdr.markForCheck();
    });
    this.runReplay();
  }

  runReplay(): void {
    this.loading = true;
    this.cdr.markForCheck();

    this.api.replayHistory$(this.targetTimestamp || undefined, this.targetHeight).subscribe({
      next: (res) => {
        this.currentState = res;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  export(format: string): void {
    if (!this.currentState) return;
    window.open(`/api/v1/intelligence/history/states/${this.currentState.state_hash}?format=${format}`, '_blank');
  }
}
