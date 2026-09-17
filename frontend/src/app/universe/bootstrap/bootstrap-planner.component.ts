import { Subscription } from 'rxjs';
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { BootstrapApiService, BootstrapPlanRequest, NodeBootstrapPlan } from './bootstrap.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/** A plan the backend refused, with the typed reason it named. */
export interface BootstrapPlanRejection {
  /** The backend's stage code, for example no-compatible-snapshot, or null when the request never got an answer body. */
  stage: string | null;
  httpStatus: number | null;
  message: string;
}

const GIB = 1073741824;

@Component({
  selector: 'app-bootstrap-planner',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Node Bootstrap Planner</h1>
          <span class="badge bg-primary">Feasibility from measurements</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Asks the owned node whether an AssumeUTXO load is feasible: measured node capabilities and disk capacity against a verified, pinned, compatible snapshot. Nothing is executed and no sync duration is estimated.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/node/bootstrap' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/node/bootstrap/snapshots' | relativeUrl">Snapshots</a>
          <a class="nav-link" [routerLink]="'/node/bootstrap/verify' | relativeUrl">Integrity Verifier</a>
          <a class="nav-link active" [routerLink]="'/node/bootstrap/planner' | relativeUrl">Bootstrap Planner</a>
          <a class="nav-link" [routerLink]="'/node/bootstrap/chainstates' | relativeUrl">Dual Chainstates</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Plan inputs</h2>
            <p class="small text-muted">
              The node, its version and its free disk are measured by the backend. Values entered here are recorded as caller declarations and compared with the measurement; they never replace it.
            </p>

            <div class="mb-3">
              <label class="form-label small text-muted" for="bootstrap-planner-height">Snapshot target height (optional; newest compatible when empty)</label>
              <input type="number" class="form-control" id="bootstrap-planner-height" [(ngModel)]="targetHeight" (ngModelChange)="clear()" />
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted" for="bootstrap-planner-disk">Declared free disk (GB, optional)</label>
              <input type="number" class="form-control" id="bootstrap-planner-disk" [(ngModel)]="availableDiskGb" (ngModelChange)="clear()" />
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted" for="bootstrap-planner-bandwidth">Declared download bandwidth (Mbps, optional)</label>
              <input type="number" class="form-control" id="bootstrap-planner-bandwidth" [(ngModel)]="bandwidthMbps" (ngModelChange)="clear()" />
            </div>

            <button class="btn btn-primary w-100" (click)="calculatePlan()" [disabled]="calculating">
              <span *ngIf="calculating" class="spinner-border spinner-border-sm me-1"></span>
              Request feasibility plan
            </button>
          </div>
        </div>

        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Plan</h2>

            <div *ngIf="rejection" class="alert alert-warning" role="alert">
              <div class="fw-bold">{{ rejectionTitle(rejection) }}</div>
              <div class="small mt-1">{{ rejection.message }}</div>
              <div class="small text-muted mt-1" *ngIf="rejection.stage">Reason code: <code>{{ rejection.stage }}</code></div>
            </div>

            <div *ngIf="!plan && !calculating && !rejection" class="text-center py-5 text-muted">
              Request a plan to see whether the owned node can load a verified snapshot.
            </div>

            <div *ngIf="calculating" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Requesting a measured bootstrap plan...</div>
            </div>

            <div *ngIf="plan">
              <div class="alert alert-success py-2 px-3">
                <div class="fw-bold">Feasible on {{ plan.node_id }} (Bitcoin Core {{ plan.node_version }})</div>
                <div class="small mt-1">Plan {{ plan.plan_id }} for {{ plan.network }}, created {{ plan.created_at }}. Nothing has been executed.</div>
              </div>

              <div class="row g-3 mb-3">
                <div class="col-12 col-md-6">
                  <div class="p-3 border rounded bg-body h-100">
                    <div class="text-muted small">Measured node ({{ plan.measured.node_observed_at }})</div>
                    <dl class="row mb-0 small mt-1">
                      <dt class="col-6 text-muted">Phase</dt><dd class="col-6 font-monospace">{{ plan.measured.current_phase }}</dd>
                      <dt class="col-6 text-muted">Tip height</dt><dd class="col-6 font-monospace">{{ plan.measured.tip_height | number }}</dd>
                      <dt class="col-6 text-muted">Headers</dt><dd class="col-6 font-monospace">{{ plan.measured.headers | number }}</dd>
                      <dt class="col-6 text-muted">Blocks on disk</dt><dd class="col-6 font-monospace">{{ gb(plan.measured.blocks_on_disk_bytes) }} GB</dd>
                      <dt class="col-6 text-muted">loadtxoutset</dt><dd class="col-6 font-monospace">{{ plan.measured.supports_loadtxoutset ? 'supported' : 'not exposed' }}</dd>
                    </dl>
                  </div>
                </div>
                <div class="col-12 col-md-6">
                  <div class="p-3 border rounded bg-body h-100">
                    <div class="text-muted small">Measured capacity ({{ plan.measured.capacity.method }}, {{ plan.measured.capacity.measured_at }})</div>
                    <dl class="row mb-0 small mt-1">
                      <dt class="col-6 text-muted">Free</dt><dd class="col-6 font-monospace">{{ gb(plan.measured.capacity.free_bytes) }} GB</dd>
                      <dt class="col-6 text-muted">Total</dt><dd class="col-6 font-monospace">{{ plan.measured.capacity.total_bytes === null ? 'not measured' : gb(plan.measured.capacity.total_bytes) + ' GB' }}</dd>
                      <dt class="col-6 text-muted">Declared free</dt>
                      <dd class="col-6 font-monospace">
                        {{ plan.caller_declared.available_disk_gb === null ? 'not declared' : plan.caller_declared.available_disk_gb + ' GB' }}
                        <span *ngIf="plan.caller_declared.matches_measurement !== null" class="text-muted">({{ plan.caller_declared.matches_measurement ? 'matches measurement' : 'differs from measurement' }})</span>
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Required bytes and headroom</div>
                <dl class="row mb-0 small mt-1">
                  <dt class="col-6 text-muted">Snapshot file</dt><dd class="col-6 font-monospace">{{ gb(plan.requirements.snapshot_file_bytes) }} GB</dd>
                  <dt class="col-6 text-muted">Chainstate estimate (assumption)</dt><dd class="col-6 font-monospace">{{ gb(plan.requirements.chainstate_estimate_bytes) }} GB</dd>
                  <dt class="col-6 text-muted">Headroom (assumption)</dt><dd class="col-6 font-monospace">{{ gb(plan.requirements.headroom_bytes) }} GB</dd>
                  <dt class="col-6 text-muted">Required</dt><dd class="col-6 font-monospace fw-bold">{{ gb(plan.requirements.required_bytes) }} GB</dd>
                  <dt class="col-6 text-muted">Measured free</dt><dd class="col-6 font-monospace fw-bold">{{ gb(plan.requirements.free_bytes) }} GB</dd>
                </dl>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Selected snapshot (verified {{ plan.selected_snapshot.verified_at }}, run {{ plan.selected_snapshot.verification_id }})</div>
                <dl class="row mb-0 small mt-1">
                  <dt class="col-6 text-muted">Snapshot</dt>
                  <dd class="col-6 font-monospace">
                    <a [routerLink]="['/node/bootstrap/snapshot' | relativeUrl, plan.selected_snapshot.height]">#{{ plan.selected_snapshot.height }}</a>
                    ({{ plan.selected_snapshot.snapshot_id }}, Core {{ plan.selected_snapshot.core_version }})
                  </dd>
                  <dt class="col-6 text-muted">Block hash</dt><dd class="col-6 font-monospace text-break">{{ plan.selected_snapshot.block_hash }}</dd>
                  <dt class="col-6 text-muted">File SHA-256</dt><dd class="col-6 font-monospace text-break">{{ plan.selected_snapshot.sha256 }}</dd>
                  <dt class="col-6 text-muted">Pinned UTXO commitment</dt><dd class="col-6 font-monospace text-break">{{ plan.selected_snapshot.utxo_commitment }}</dd>
                  <dt class="col-6 text-muted">Size</dt><dd class="col-6 font-monospace">{{ gb(plan.selected_snapshot.size_bytes) }} GB</dd>
                </dl>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Download estimates (assumptions, not measurements)</div>
                <div class="small mt-1" *ngIf="plan.estimates.snapshot_download_hours === null && plan.estimates.ibd_download_hours === null">
                  Not estimated: {{ plan.estimates.basis }}.
                </div>
                <dl class="row mb-0 small mt-1" *ngIf="plan.estimates.snapshot_download_hours !== null || plan.estimates.ibd_download_hours !== null">
                  <dt class="col-6 text-muted">Snapshot download</dt><dd class="col-6 font-monospace">{{ hours(plan.estimates.snapshot_download_hours) }}</dd>
                  <dt class="col-6 text-muted">Block download</dt><dd class="col-6 font-monospace">{{ hours(plan.estimates.ibd_download_hours) }}</dd>
                  <dt class="col-6 text-muted">Basis</dt><dd class="col-6">{{ plan.estimates.basis }}</dd>
                </dl>
                <div class="small text-muted mt-1">Validation time is not estimated: the backend has no measurement of the node's CPU or disk throughput.</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Assumptions</div>
                <ul class="small mb-0 mt-1"><li *ngFor="let a of plan.assumptions">{{ a }}</li></ul>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Expected chainstate transitions</div>
                <div class="font-monospace small mt-1">{{ plan.expected_transitions.join(' -> ') }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Actions not executed</div>
                <ul class="small mb-0 mt-1"><li *ngFor="let a of plan.actions_not_executed">{{ a }}</li></ul>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Rollback</div>
                <ul class="small mb-0 mt-1"><li *ngFor="let r of plan.rollback_instructions">{{ r }}</li></ul>
              </div>

              <div class="alert alert-info py-2 px-3 small m-0">
                Core validates the pinned hash_serialized_3 itself before activating a snapshot chainstate. This plan does not establish node readiness.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class BootstrapPlannerComponent implements OnInit, OnDestroy {
  private networkSub?: Subscription;
  private request?: Subscription;
  targetHeight: number | null = null;
  availableDiskGb: number | null = null;
  bandwidthMbps: number | null = null;
  calculating = false;
  plan: NodeBootstrapPlan | null = null;
  rejection: BootstrapPlanRejection | null = null;

  constructor(
    private bootstrapApi: BootstrapApiService,
    private cdr: ChangeDetectorRef
  ) {}

  /** Kept for callers and tests that read the failure as text. */
  get failure(): string | null {return this.rejection?.message ?? null;}

  ngOnInit(): void {this.networkSub=this.bootstrapApi.networkChanged$.subscribe(() => this.clear());}
  clear(): void {this.request?.unsubscribe();this.plan=null;this.calculating=false;this.rejection=null;this.cdr.markForCheck();}
  ngOnDestroy(): void {this.clear();this.networkSub?.unsubscribe();}

  gb(bytes: number): string {return (bytes / GIB).toFixed(2);}
  hours(value: number | null): string {return value === null ? 'not estimated' : value + ' h (assumed)';}

  rejectionTitle(rejection: BootstrapPlanRejection): string {
    switch (rejection.stage) {
      case 'no-compatible-snapshot': return 'No compatible snapshot';
      case 'snapshot-not-verified': return 'Snapshot not verified over its bytes';
      case 'insufficient-capacity': return 'Measured free space is insufficient';
      case 'capacity-not-measured': return 'Disk capacity was not measured';
      case 'stale-measurement': return 'Node measurement is stale';
      case 'chainstate-not-eligible': return 'Chainstate is not eligible for a load';
      case 'node-capability-missing': return 'Node capability missing';
      case 'unsupported-version': return 'Unsupported Bitcoin Core version';
      case 'unsupported-network': return 'Unsupported network';
      case 'node-not-observed': return 'Node not observed';
      case 'durable-store-unavailable':
      case 'unavailable-node-source': return 'Planning source unavailable';
      default: return rejection.httpStatus === 404 ? 'Not found' : rejection.httpStatus && rejection.httpStatus >= 500 ? 'Planner unavailable' : 'Plan rejected';
    }
  }

  private number(value: number | null | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  calculatePlan(): void {
    this.clear();
    this.calculating = true;
    const request: BootstrapPlanRequest = {};
    const height = this.number(this.targetHeight);
    if (height !== undefined) request.target_height = height;
    const disk = this.number(this.availableDiskGb);
    if (disk !== undefined) request.available_disk_gb = disk;
    const bandwidth = this.number(this.bandwidthMbps);
    if (bandwidth !== undefined) request.bandwidth_mbps = bandwidth;

    this.request = this.bootstrapApi
      .generateBootstrapPlan$(request)
      .subscribe({
        next: (res) => {
          if (!this.isMeasuredPlan(res, height)) {
            this.rejection = { stage: null, httpStatus: null, message: 'No measured, feasible, network-bound bootstrap plan was returned.' };
            this.plan = null;
          } else {this.plan = res;}
          this.calculating = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.calculating = false;
          this.plan = null;
          const stage = typeof err?.error?.stage === 'string' ? err.error.stage : null;
          this.rejection = {
            stage,
            httpStatus: typeof err?.status === 'number' ? err.status : null,
            message: err?.error?.error || loadFailureMessage(classifyLoadFailure(err)),
          };
          this.cdr.markForCheck();
        },
      });
  }

  private isMeasuredPlan(res: NodeBootstrapPlan | null | undefined, requestedHeight: number | undefined): res is NodeBootstrapPlan {
    return !!res
      && res.network === this.bootstrapApi.network
      && res.measurement_status === 'measured'
      && res.requirements?.feasible === true
      && !!res.selected_snapshot?.verification_id
      && !!res.measured?.capacity
      && Array.isArray(res.assumptions)
      && Array.isArray(res.actions_not_executed)
      && (requestedHeight === undefined || res.target_height === requestedHeight);
  }
}
