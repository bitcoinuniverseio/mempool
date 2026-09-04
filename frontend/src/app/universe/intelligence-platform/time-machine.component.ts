import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
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
        <div *ngIf="coverage.coverage_gaps?.length > 0" class="small text-warning">
          ⚠ {{ coverage.coverage_gaps.length }} documented maintenance intervals
        </div>
      </div>

      <!-- Scrub Controls -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Replay Target</h4>
          <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadSampleTarget()">
            Load Sample Target (860,020)
          </button>
        </div>
        <div class="card-body">
          <div class="row g-3 align-items-end">
            <div class="col-md-5">
              <label class="form-label small text-muted" for="targetHeight">Target Block Height</label>
              <input
                id="targetHeight"
                type="number"
                class="form-control font-monospace"
                [(ngModel)]="targetHeight"
                placeholder="e.g. 860020"
              />
            </div>
            <div class="col-md-4">
              <label class="form-label small text-muted" for="targetTimestamp">Or Target ISO Timestamp</label>
              <input
                id="targetTimestamp"
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="targetTimestamp"
                placeholder="2026-08-20T12:00:00Z"
              />
            </div>
            <div class="col-md-3">
              <button
                type="button"
                class="btn btn-primary w-100"
                [disabled]="loading || (!targetHeight && !targetTimestamp.trim())"
                (click)="runReplay()"
              >
                {{ loading ? 'Replaying Events...' : 'Replay Mempool State' }}
              </button>
            </div>
          </div>

          <div *ngIf="replayError" class="alert alert-danger mt-3 mb-0">
            {{ replayError }}
          </div>
        </div>
      </section>

      <!-- Initial Prompt -->
      <div *ngIf="!currentState && !loading && !replayError" class="p-4 rounded bg-dark-subtle text-muted text-center mb-4">
        Specify a historical block height or timestamp above to reconstruct exact unconfirmed transaction state.
      </div>

      <!-- Reconstructed State View -->
      <section *ngIf="currentState" class="results-section">
        <div class="card mb-4 border-primary">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <span class="badge badge-primary">STATE RECONSTRUCTED</span>
              <h4 class="mt-1 mb-0 font-monospace text-break">{{ currentState.state_hash }}</h4>
            </div>
            <div class="btn-group">
              <button type="button" class="btn btn-sm btn-outline-secondary" (click)="exportData('json')">Export JSON</button>
              <button type="button" class="btn btn-sm btn-outline-secondary" (click)="exportData('parquet')">Export Parquet</button>
            </div>
          </div>
          <div class="card-body">
            <div class="row text-center g-3 mb-4">
              <div class="col-md-3 col-6">
                <div class="p-3 rounded bg-dark-subtle h-100">
                  <div class="small text-muted">Mempool Transactions</div>
                  <div class="h3 my-1">{{ currentState.total_transactions | number }}</div>
                  <div class="small text-muted">Height {{ currentState.target_block_height }}</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-3 rounded bg-dark-subtle h-100">
                  <div class="small text-muted">Total Mempool Weight</div>
                  <div class="h3 my-1 text-primary">{{ (currentState.total_weight / 4000000).toFixed(2) }} MvB</div>
                  <div class="small text-muted">{{ currentState.projected_blocks_count }} projected blocks</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-3 rounded bg-dark-subtle h-100">
                  <div class="small text-muted">Total Unconfirmed Fees</div>
                  <div class="h3 my-1">{{ (currentState.total_fees_sats / 100000000).toFixed(4) }} BTC</div>
                  <div class="small text-muted">{{ currentState.total_fees_sats | number }} sats</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-3 rounded bg-dark-subtle h-100">
                  <div class="small text-muted">Median Feerate</div>
                  <div class="h3 my-1 text-success">{{ currentState.median_feerate_sats_vb }} sat/vB</div>
                  <div class="small text-muted">At checkpoint {{ currentState.nearest_checkpoint_id }}</div>
                </div>
              </div>
            </div>

            <!-- Historical Fee Histogram -->
            <h5 class="mb-3" *ngIf="currentState.histogram">Fee Rate Histogram At State</h5>
            <div class="table-responsive" *ngIf="currentState.histogram">
              <table class="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th>Feerate Band</th>
                    <th>Transactions</th>
                    <th>Weight</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let h of currentState.histogram">
                    <td class="fw-bold font-monospace">{{ h.feerate_band }} sat/vB</td>
                    <td>{{ h.tx_count | number }}</td>
                    <td>{{ (h.weight / 4000).toFixed(1) }} kvB</td>
                    <td>{{ h.share_percent }}%</td>
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
    .badge-primary { background-color: var(--primary, #0d6efd); color: #fff; }
    .badge-secondary { background-color: var(--secondary, #6c757d); color: #fff; }
  `],
})
export class TimeMachineComponent implements OnInit, OnDestroy {
  coverage: any = null;
  currentState: any = null;
  targetHeight: number | null = null;
  targetTimestamp = '';
  loading = false;
  replayError: string | null = null;

  private subs: Subscription[] = [];

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subs.push(
      this.api.getTimeMachineCoverage$().subscribe({
        next: (res) => {
          this.coverage = res;
          this.cdr.markForCheck();
        },
        error: () => {
          this.cdr.markForCheck();
        },
      })
    );
  }

  loadSampleTarget(): void {
    this.targetHeight = 860020;
    this.targetTimestamp = '';
    this.runReplay();
  }

  runReplay(): void {
    if (!this.targetHeight && !this.targetTimestamp.trim()) return;
    this.loading = true;
    this.replayError = null;
    this.cdr.markForCheck();

    this.subs.push(
      this.api.replayHistory$(this.targetTimestamp || undefined, this.targetHeight || undefined).subscribe({
        next: (res) => {
          this.currentState = res;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.replayError = err?.error?.error || err?.message || 'Historical replay failed for target';
          this.loading = false;
          this.cdr.markForCheck();
        },
      })
    );
  }

  exportData(format: string): void {
    if (!this.currentState) return;
    window.open(`/api/v1/intelligence/history/states/${this.currentState.state_hash}?format=${format}`, '_blank');
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
  }
}
