import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, Optional } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, map, switchMap } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';
import { StateService } from '@app/services/state.service';
import { atomicToDisplay } from '../portfolio/shared/exact';
import { HistoryParquetService } from './history-parquet.service';

function sortedHistoryState(value: unknown): unknown {
  if (Array.isArray(value)) { return value.map(sortedHistoryState); }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedHistoryState((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function validHistoryUtc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

function validHistorySummary(value: any, network: string): boolean {
  const integer = (n: unknown): boolean => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  return !!value && typeof value.state_hash === 'string' && /^[0-9a-f]{64}$/.test(value.state_hash)
    && typeof value.checkpoint_block_hash === 'string' && /^[0-9a-f]{64}$/.test(value.checkpoint_block_hash)
    && typeof value.nearest_checkpoint_id === 'string' && value.nearest_checkpoint_id.startsWith('chk-' + network + '-') && value.nearest_checkpoint_id.length <= 128
    && validHistoryUtc(value.target_timestamp_utc)
    && ['target_block_height', 'applied_events_count', 'total_transactions', 'total_vsize', 'total_weight', 'total_fees_sats', 'projected_blocks_count'].every(key => integer(value[key]))
    && typeof value.median_feerate_sats_vb === 'number' && Number.isFinite(value.median_feerate_sats_vb) && value.median_feerate_sats_vb >= 0
    && ['complete', 'partial', 'gap_detected'].includes(value.coverage_status)
    && Array.isArray(value.fee_distribution) && value.fee_distribution.length <= 5 && value.fee_distribution.every((row: any) => row && typeof row.feerate_bucket === 'string' && row.feerate_bucket.length > 0 && row.feerate_bucket.length <= 128 && integer(row.count) && integer(row.total_vsize))
    && Array.isArray(value.gap_intervals) && value.gap_intervals.length <= 50000 && value.gap_intervals.every((gap: any) => gap && validHistoryUtc(gap.start_utc) && validHistoryUtc(gap.end_utc) && Date.parse(gap.end_utc) >= Date.parse(gap.start_utc) && typeof gap.reason === 'string' && gap.reason.length > 0 && gap.reason.length <= 256);
}

function validHistoryCoverage(value: any, network: string): boolean {
  const integer = (n: unknown): boolean => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const nullableUtc = (s: unknown): boolean => s === null || validHistoryUtc(s);
  return !!value && value.network === network && typeof value.observer_id === 'string' && value.observer_id.length > 0 && value.observer_id.length <= 128
    && validHistoryUtc(value.observing_since_utc) && nullableUtc(value.earliest_recorded_event_utc) && nullableUtc(value.latest_recorded_event_utc) && nullableUtc(value.observed_through_utc)
    && integer(value.total_events) && value.total_events <= 50000 && integer(value.total_checkpoints) && value.total_checkpoints <= 288
    && (value.total_checkpoints === 0 ? value.earliest_checkpoint_height === null && value.latest_checkpoint_height === null : integer(value.earliest_checkpoint_height) && integer(value.latest_checkpoint_height) && value.latest_checkpoint_height >= value.earliest_checkpoint_height)
    && typeof value.persistence?.enabled === 'boolean' && typeof value.persistence.pending === 'boolean' && (value.persistence.error === null || typeof value.persistence.error === 'string')
    && Array.isArray(value.coverage_gaps) && value.coverage_gaps.length <= 50001 && value.coverage_gaps.every((gap: any) => gap && validHistoryUtc(gap.start_utc) && validHistoryUtc(gap.end_utc) && Date.parse(gap.end_utc) >= Date.parse(gap.start_utc) && typeof gap.reason === 'string' && gap.reason.length > 0 && gap.reason.length <= 256);
}

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
      <p *ngIf="coverageError" role="alert">{{ coverageError }}</p>
      <ng-container *ngIf="coverage">
        <p>History persistence: {{ coverage.persistence.enabled ? 'Enabled' : 'Disabled' }}{{ coverage.persistence.pending ? ' Â· Pending write' : '' }}</p>
        <p *ngIf="coverage.persistence.error" role="alert">{{ coverage.persistence.error }}</p>
        <details *ngIf="coverage.coverage_gaps.length"><summary>Observed coverage gaps</summary><pre>{{ coverage.coverage_gaps | json }}</pre></details>
      </ng-container>

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
              <button type="button" class="btn btn-sm btn-outline-secondary" [disabled]="exporting" (click)="exportData('parquet')">Export Parquet</button>
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
                  <div class="h3 my-1 text-primary">{{ formatWeight(currentState.total_weight) }}</div>
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
                    <td class="fw-bold font-monospace">{{ h.feerate_bucket }}</td>
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
  coverageError: string | null = null;
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
    @Optional() private parquet: HistoryParquetService = null,
  ) {}

  ngOnInit(): void {
    let selectedNetwork = this.network;
    this.loadCoverage();
    this.networkRead = this.state?.networkChanged$.subscribe(() => {
      if (selectedNetwork === this.network) { return; }
      selectedNetwork = this.network;
      this.invalidate(); this.coverage = null; this.loadCoverage();
    });
  }

  private get network(): string { return this.state?.network || this.state?.env?.ROOT_NETWORK || 'mainnet'; }
  private loadCoverage(): void {
    this.coverageRead?.unsubscribe(); const network = this.network;
    this.coverage = null; this.coverageError = null;
    this.coverageRead = this.api.getTimeMachineCoverage$().subscribe({
        next: (res) => {
          if (this.destroyed || this.network !== network) { return; }
          if (!validHistoryCoverage(res, network)) { this.coverageError = 'History coverage does not match the selected network or contains incomplete observations.'; this.cdr.markForCheck(); return; }
          this.coverage = res;
          this.cdr.markForCheck();
        },
        error: () => {
          if (this.destroyed || this.network !== network) { return; }
          this.coverage = null;
          this.coverageError = 'Owned history coverage unavailable.';
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

  formatWeight(value: unknown): string {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) { return 'Not reported'; }
    return atomicToDisplay(String(value), 6) + ' MWU';
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
    if ((height != null && timestamp) || (height != null && (!Number.isSafeInteger(height) || height < 0)) || (timestamp && !validHistoryUtc(timestamp))) {
      this.replayError = 'Supply one nonnegative integer block height or one ISO 8601 UTC timestamp.'; return;
    }
    this.loading = true;
    this.replayError = null;
    this.cdr.markForCheck();

    this.replay = this.api.replayHistory$(timestamp || undefined, height ?? undefined).subscribe({
        next: (res) => {
          if (this.destroyed || revision !== this.revision || network !== this.network || height !== this.targetHeight || timestamp !== this.targetTimestamp.trim()) { return; }
          if (!validHistorySummary(res, network) || (height != null && res.target_block_height !== height) || (timestamp && Date.parse(res.target_timestamp_utc) !== Date.parse(timestamp))) {
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
    if (!this.currentState || !['json', 'parquet'].includes(format) || this.exporting || !this.state?.isBrowser) { return; }
    if (format === 'parquet' && !this.parquet) { this.exportError = 'The isolated Parquet reader is unavailable.'; this.cdr.markForCheck(); return; }
    const hash = this.currentState.state_hash, revision = this.revision, network = this.network;
    // The producer may cache another replay summary under the same membership hash.
    const capturedSummary = JSON.stringify(sortedHistoryState(this.currentState));
    const checkpointHash = this.currentState.checkpoint_block_hash, transactionCount = this.currentState.total_transactions;
    this.exporting = true; this.exportError = null;
    const request = format === 'json' ? this.api.exportHistory$(hash) : this.api.exportHistoryParquet$(hash).pipe(
      switchMap(file => this.parquet.read(file, network).pipe(map(result => ({ ...result, parquetBytes: file })))),
    );
    this.exportRead = request.subscribe({next: async result => {
      if (this.destroyed || revision !== this.revision || network !== this.network || this.currentState?.state_hash !== hash) { return; }
      if (result?.format !== format || result?.state?.state_hash !== hash || JSON.stringify(sortedHistoryState(result.state)) !== capturedSummary || !Array.isArray(result.txids) || result.txids.length !== transactionCount || new Set(result.txids).size !== transactionCount || result.txids.some((id: unknown) => typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) || format === 'parquet' && !(result.parquetBytes instanceof ArrayBuffer)) { this.exporting = false; this.exportError = 'Export does not match the selected retained state.'; this.cdr.markForCheck(); return; }
      try {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(checkpointHash + ':' + [...result.txids].sort().join(','))));
        if (this.destroyed || revision !== this.revision || network !== this.network || this.currentState?.state_hash !== hash) { return; }
        this.exporting = false;
        if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== hash) { this.exportError = 'Export membership does not match the selected retained state.'; this.cdr.markForCheck(); return; }
        const blob = format === 'json' ? new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'}) : new Blob([result.parquetBytes], {type: 'application/vnd.apache.parquet'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = 'mempool-state-' + hash + '.' + format;
        try { link.click(); } finally { URL.revokeObjectURL(url); }
      } catch { if (this.destroyed || revision !== this.revision || network !== this.network) { return; } this.exporting = false; this.exportError = 'Unable to verify or download the retained ' + format + ' state.'; }
      this.cdr.markForCheck();
    }, error: () => { if (revision === this.revision && !this.destroyed && network === this.network) { this.exporting = false; this.exportError = 'Retained ' + format + ' export unavailable or verification failed.'; this.cdr.markForCheck(); } }});
  }

  ngOnDestroy(): void {
    this.destroyed = true; this.invalidate(); this.coverageRead?.unsubscribe(); this.networkRead?.unsubscribe();
  }
}
