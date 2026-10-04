import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, Optional } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';
import { StateService } from '@app/services/state.service';
import { atomicToDisplay } from '../portfolio/shared/exact';

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
          Replay the mempool as this node observed it at a past block height or time.
        </p>
      </header>

      <!-- Coverage Indicator -->
      <div *ngIf="coverage" class="alert alert-info d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
        <div *ngIf="coverage.total_checkpoints > 0; else noCoverage">
          <strong>Coverage</strong>
          <span> heights {{ coverage.earliest_checkpoint_height | number }} to {{ coverage.latest_checkpoint_height | number }}, since {{ coverage.observing_since_utc | date:'short' }}</span>
          <span class="badge badge-secondary ms-2">{{ coverage.total_checkpoints }} checkpoints</span>
        </div>
        <ng-template #noCoverage><span>No checkpoint recorded yet; the first one arrives with the next block.</span></ng-template>
      </div>

      <!-- Scrub Controls -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Replay Target</h4>
          <button type="button" class="btn btn-sm btn-outline-secondary" *ngIf="coverage?.latest_checkpoint_height != null" (click)="loadLatestCheckpoint()">
            Latest checkpoint ({{ coverage.latest_checkpoint_height | number }})
          </button>
        </div>
        <div class="card-body">
          <div class="row g-3 align-items-end">
            <div class="col-md-5">
              <label class="form-label small text-muted" for="targetHeight">Block height</label>
              <input
                id="targetHeight"
                type="number"
                class="form-control font-monospace"
                [(ngModel)]="targetHeight"
                (ngModelChange)="invalidate()"
                [placeholder]="coverage?.latest_checkpoint_height ? 'e.g. ' + coverage.latest_checkpoint_height : 'height'"
              />
            </div>
            <div class="col-md-4">
              <label class="form-label small text-muted" for="targetTimestamp">Or time (ISO 8601, UTC)</label>
              <input
                id="targetTimestamp"
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="targetTimestamp"
                (ngModelChange)="invalidate()"
                [placeholder]="coverage?.latest_recorded_event_utc || 'YYYY-MM-DDTHH:MM:SSZ'"
              />
            </div>
            <div class="col-md-3">
              <button
                type="button"
                class="btn btn-primary w-100"
                [disabled]="loading || (targetHeight == null && !targetTimestamp.trim())"
                (click)="runReplay()"
              >
                {{ loading ? 'Replaying Events...' : 'Replay Mempool State' }}
              </button>
            </div>
          </div>

          <div *ngIf="replayError" role="alert" class="alert alert-danger mt-3 mb-0">
            {{ replayError }}
          </div>
        </div>
      </section>

      <!-- Initial Prompt -->
      <div *ngIf="!currentState && !loading && !replayError" class="p-4 rounded bg-dark-subtle text-muted text-center mb-4">
        Pick a block height or time to replay.
      </div>

      <!-- Reconstructed State View -->
      <section *ngIf="currentState" class="results-section">
        <div class="card mb-4 border-primary">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <span class="badge badge-primary">RETAINED OBSERVATIONS: {{ currentState.coverage_status }}</span>
              <p>Coverage describes this node's retained observation window. Observation gaps and events outside that window remain unknown.</p>
              <h4 class="mt-1 mb-0 font-monospace text-break">{{ currentState.state_hash }}</h4>
            </div>
            <div class="btn-group">
              <button type="button" class="btn btn-sm btn-outline-secondary" [disabled]="exporting" (click)="exportData('json')">Export JSON</button>
            </div>
          </div>
          <div class="card-body">
            <p *ngIf="exportError" role="alert">{{ exportError }}</p>
            <p *ngIf="currentState.gap_intervals?.length">Recorded observation gaps: {{ currentState.gap_intervals | json }}</p>
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
                  <div class="h3 my-1">{{ formatFees(currentState.total_fees_sats) }}</div>
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
            <h5 class="mb-3" *ngIf="currentState.fee_distribution">Fee Rate Distribution At State</h5>
            <div class="table-responsive" *ngIf="currentState.fee_distribution" tabindex="0">
              <table class="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th>Feerate Band</th>
                    <th>Transactions</th>
                    <th>Virtual bytes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let h of currentState.fee_distribution">
                    <td class="fw-bold font-monospace">{{ h.feerate_bucket }} sat/vB</td>
                    <td>{{ h.count | number }}</td>
                    <td>{{ h.total_vsize | number }} vB</td>
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
  exporting = false; exportError: string | null = null;
  private revision = 0; private destroyed = false;
  private replay?: Subscription; private coverageRead?: Subscription; private networkRead?: Subscription; private exportRead?: Subscription;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef,
    @Optional() private state: StateService = null,
  ) {}

  ngOnInit(): void {
    this.loadCoverage();
    this.networkRead = this.state?.networkChanged$.subscribe(() => { this.invalidate(); this.coverage = null; this.loadCoverage(); });
  }

  private get network(): string { return this.state?.network || this.state?.env?.ROOT_NETWORK || 'mainnet'; }
  private loadCoverage(): void {
    this.coverageRead?.unsubscribe(); const network = this.network;
    this.coverageRead = this.api.getTimeMachineCoverage$().subscribe({
        next: (res) => {
          if (this.destroyed || this.network !== network) { return; }
          this.coverage = res;
          this.cdr.markForCheck();
        },
        error: () => {
          this.coverage = null;
          this.cdr.markForCheck();
        },
      });
  }

  invalidate(): void {
    this.revision++; this.replay?.unsubscribe(); this.exportRead?.unsubscribe();
    this.currentState = null; this.loading = false; this.replayError = null; this.exporting = false; this.exportError = null;
    this.cdr.markForCheck();
  }

  formatFees(value: unknown): string {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) { return 'Not reported'; }
    return atomicToDisplay(String(value), 8) + ' BTC';
  }

  loadLatestCheckpoint(): void {
    if (!Number.isSafeInteger(this.coverage?.latest_checkpoint_height) || this.coverage.latest_checkpoint_height < 0) { return; }
    this.targetHeight = this.coverage.latest_checkpoint_height;
    this.targetTimestamp = '';
    this.runReplay();
  }

  runReplay(): void {
    this.invalidate(); const height = this.targetHeight, timestamp = this.targetTimestamp.trim(), revision = this.revision, network = this.network;
    if (height == null && !timestamp) { return; }
    if ((height != null && timestamp) || (height != null && (!Number.isSafeInteger(height) || height < 0)) || (timestamp && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))))) {
      this.replayError = 'Supply one nonnegative integer block height or one ISO 8601 UTC timestamp.'; return;
    }
    this.loading = true;
    this.replayError = null;
    this.cdr.markForCheck();

    this.replay = this.api.replayHistory$(timestamp || undefined, height ?? undefined).subscribe({
        next: (res) => {
          if (this.destroyed || revision !== this.revision || network !== this.network || height !== this.targetHeight || timestamp !== this.targetTimestamp.trim()) { return; }
          if (!res || !/^[0-9a-f]{64}$/.test(res.state_hash) || !['complete', 'partial', 'gap_detected'].includes(res.coverage_status) || (height != null && res.target_block_height !== height) || (timestamp && Date.parse(res.target_timestamp_utc) !== Date.parse(timestamp))) {
            this.replayError = 'Historical evidence does not match the selected target.'; this.loading = false; this.cdr.markForCheck(); return;
          }
          this.currentState = res;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          if (this.destroyed || revision !== this.revision || network !== this.network) { return; }
          this.replayError = err?.error?.error || err?.message || 'Historical replay failed for target';
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  exportData(format: string): void {
    if (!this.currentState || format !== 'json' || this.exporting || !this.state?.isBrowser) { return; }
    const hash = this.currentState.state_hash, revision = this.revision, network = this.network;
    this.exporting = true; this.exportError = null;
    this.exportRead = this.api.exportHistory$(hash).subscribe({next: result => {
      if (this.destroyed || revision !== this.revision || network !== this.network || this.currentState?.state_hash !== hash) { return; }
      this.exporting = false;
      if (result?.format !== 'json' || result?.state?.state_hash !== hash || !Array.isArray(result.txids) || result.txids.some((id: unknown) => typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id))) { this.exportError = 'Export does not match the selected retained state.'; this.cdr.markForCheck(); return; }
      try {
        const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'}));
        const link = document.createElement('a'); link.href = url; link.download = 'mempool-state-' + hash + '.json'; link.click(); URL.revokeObjectURL(url);
      } catch { this.exportError = 'Unable to download the retained JSON state.'; }
      this.cdr.markForCheck();
    }, error: () => { if (revision === this.revision && !this.destroyed) { this.exporting = false; this.exportError = 'Retained JSON export unavailable.'; this.cdr.markForCheck(); } }});
  }

  ngOnDestroy(): void {
    this.destroyed = true; this.invalidate(); this.coverageRead?.unsubscribe(); this.networkRead?.unsubscribe();
  }
}
