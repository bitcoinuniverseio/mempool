import { Subscription, timer } from 'rxjs';
import { exhaustMap, take } from 'rxjs/operators';
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import {
  BootstrapApiService,
  BootstrapVerificationRequest,
  BOOTSTRAP_TERMINAL_VERIFICATION_STATES,
  BOOTSTRAP_VERIFICATION_CHECKS,
  NodeBootstrapCheck,
  NodeBootstrapCheckName,
  NodeBootstrapVerification,
} from './bootstrap.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/** How the request or the readback of a run failed, with the backend's typed reason. */
export interface BootstrapVerifyFailure {
  /** not-found: 404, the snapshot is not in the catalogue or the run is unknown; unavailable: 5xx; rejected: 4xx input; other: transport. */
  kind: 'not-found' | 'unavailable' | 'rejected' | 'other';
  stage: string | null;
  httpStatus: number | null;
  message: string;
}

/** Readback interval and bound: a run over gigabytes takes minutes, so this stops after ten minutes of readback. */
export const BOOTSTRAP_VERIFY_POLL_MS = 3000;
export const BOOTSTRAP_VERIFY_MAX_POLLS = 200;

const HEX64 = /^[0-9a-fA-F]{64}$/;

@Component({
  selector: 'app-bootstrap-verify',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">AssumeUTXO Snapshot Verifier</h1>
          <span class="badge bg-success">Verification over the bytes</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Starts a backend verification run over the catalogue snapshot's actual bytes: file size, SHA-256, manifest signature, network magic, base block, coin count and the streamed UTXO commitment against the operator-pinned Bitcoin Core value. Checksums you enter are compared and reported; they never decide the outcome.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/node/bootstrap' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/node/bootstrap/snapshots' | relativeUrl">Snapshots</a>
          <a class="nav-link active" [routerLink]="'/node/bootstrap/verify' | relativeUrl">Integrity Verifier</a>
          <a class="nav-link" [routerLink]="'/node/bootstrap/planner' | relativeUrl">Bootstrap Planner</a>
          <a class="nav-link" [routerLink]="'/node/bootstrap/chainstates' | relativeUrl">Dual Chainstates</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Start a verification run</h2>

            <div class="mb-3">
              <label class="form-label small text-muted" for="bootstrap-verify-height">Catalogue snapshot height</label>
              <input type="number" class="form-control" id="bootstrap-verify-height" [(ngModel)]="snapshotHeight" (ngModelChange)="clear()" />
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted" for="bootstrap-verify-checksum">Your file SHA-256 (optional, compared only)</label>
              <input type="text" class="form-control font-monospace small" id="bootstrap-verify-checksum" [(ngModel)]="computedSha256" (ngModelChange)="clear()" />
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted" for="bootstrap-verify-utxo-hash">Your hash_serialized_3 (optional, compared only)</label>
              <input type="text" class="form-control font-monospace small" id="bootstrap-verify-utxo-hash" [(ngModel)]="computedUtxoHash" (ngModelChange)="clear()" />
            </div>

            <button class="btn btn-primary w-100" (click)="verifyChecksum()" [disabled]="verifying || polling">
              <span *ngIf="verifying || polling" class="spinner-border spinner-border-sm me-1"></span>
              {{ polling ? 'Verification running...' : 'Verify snapshot bytes' }}
            </button>
            <button *ngIf="polling" class="btn btn-outline-secondary w-100 mt-2" (click)="clear()">Stop waiting</button>
          </div>
        </div>

        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Verification run</h2>

            <div *ngIf="failure" class="alert alert-warning" role="alert">
              <div class="fw-bold">{{ failureTitle(failure) }}</div>
              <div class="small mt-1">{{ failure.message }}</div>
              <div class="small text-muted mt-1" *ngIf="failure.stage">Reason code: <code>{{ failure.stage }}</code></div>
            </div>

            <div *ngIf="!report && !verifying && !failure" class="text-center py-5 text-muted">
              Enter a catalogue snapshot height and start a run.
            </div>

            <div *ngIf="verifying" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Requesting a verification run...</div>
            </div>

            <div *ngIf="report">
              <div class="alert" [ngClass]="stateClass(report.state)">
                <div class="fw-bold">{{ stateTitle(report.state) }}</div>
                <div class="small mt-1">{{ report.details }}</div>
                <div class="small text-muted mt-1">
                  Run {{ report.verification_id }} for snapshot {{ report.snapshot_id }} on {{ report.network }}; requested {{ report.requested_at }}<span *ngIf="report.finished_at">, finished {{ report.finished_at }}</span>.
                </div>
                <div class="small mt-1" *ngIf="polling">Reading the run back every {{ pollSeconds }} s (readback {{ polls }} of {{ maxPolls }}).</div>
                <div class="small mt-1" *ngIf="pollExhausted">Stopped reading back after {{ maxPolls }} readbacks; the run may still be in progress. Start again to read run {{ report.verification_id }} back.</div>
              </div>

              <div class="table-responsive mb-3" tabindex="0" role="region" aria-label="Verification checks, scroll horizontally" i18n-aria-label>
                <table class="table table-sm align-middle mb-0">
                  <thead><tr><th>Check</th><th>Result</th><th>Expected</th><th>Observed</th><th>Reason</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let c of checks(report)">
                      <td class="font-monospace small">{{ c.name }}</td>
                      <td><span class="badge" [ngClass]="checkClass(c.check.status)">{{ c.check.status }}</span></td>
                      <td class="font-monospace small text-break">{{ c.check.expected ?? '' }}</td>
                      <td class="font-monospace small text-break">{{ c.check.observed ?? '' }}</td>
                      <td class="small">{{ c.check.reason || '' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Your inputs (compared with the run, not the authority)</div>
                <dl class="row mb-0 small mt-1">
                  <dt class="col-4 text-muted">Height</dt><dd class="col-8 font-monospace">{{ report.caller_inputs.height ?? 'not given' }}</dd>
                  <dt class="col-4 text-muted">SHA-256</dt><dd class="col-8 font-monospace text-break">{{ report.caller_inputs.sha256 ?? 'not given' }}</dd>
                  <dt class="col-4 text-muted">hash_serialized_3</dt><dd class="col-8 font-monospace text-break">{{ report.caller_inputs.utxo_hash ?? 'not given' }}</dd>
                  <dt class="col-4 text-muted">Match the run</dt><dd class="col-8">{{ report.caller_inputs.matched === null ? 'not compared yet' : report.caller_inputs.matched ? 'yes' : 'no' }}</dd>
                </dl>
              </div>

              <div class="p-3 border rounded bg-body mb-3" *ngIf="report.evidence">
                <div class="text-muted small">Evidence</div>
                <dl class="row mb-0 small mt-1">
                  <dt class="col-4 text-muted">Source</dt><dd class="col-8 font-monospace text-break">{{ report.evidence.source_kind ?? 'unknown' }} {{ report.evidence.source_ref ?? '' }}</dd>
                  <dt class="col-4 text-muted">Bytes read</dt><dd class="col-8 font-monospace">{{ report.evidence.bytes_read | number }}</dd>
                  <dt class="col-4 text-muted">Header format</dt><dd class="col-8 font-monospace">{{ report.evidence.header_format ?? 'not read' }}<span *ngIf="report.evidence.snapshot_version !== null"> (version {{ report.evidence.snapshot_version }})</span></dd>
                  <dt class="col-4 text-muted">Core node</dt><dd class="col-8 font-monospace">{{ report.evidence.core_node_id ?? 'not consulted' }}</dd>
                  <dt class="col-4 text-muted">Core block at height</dt><dd class="col-8 font-monospace text-break">{{ report.evidence.core_block_hash_at_height ?? 'not consulted' }}</dd>
                  <dt class="col-4 text-muted">Pinned commitment</dt><dd class="col-8">{{ report.evidence.pinned_commitment_source ?? 'none pinned' }}</dd>
                </dl>
              </div>

              <div class="p-3 border rounded bg-body mb-3" *ngIf="report.checkpoints?.length">
                <div class="text-muted small">Checkpoints</div>
                <ul class="small mb-0 mt-1 font-monospace">
                  <li *ngFor="let cp of report.checkpoints">{{ cp.at }} {{ cp.stage }}<span *ngIf="cp.detail">: {{ cp.detail }}</span></li>
                </ul>
              </div>

              <div class="alert alert-info py-2 px-3 small m-0">
                Core independently checks its pinned serialized UTXO commitment during snapshot loading. No node operation is performed here.
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
export class BootstrapVerifyComponent implements OnInit, OnDestroy {
  private networkSub?: Subscription;
  private request?: Subscription;
  private poll?: Subscription;
  snapshotHeight: number | null = null;
  computedSha256 = '';
  computedUtxoHash = '';
  /** The POST is in flight. */
  verifying = false;
  /** A run was accepted and is being read back until it reaches a final state. */
  polling = false;
  polls = 0;
  pollExhausted = false;
  readonly maxPolls = BOOTSTRAP_VERIFY_MAX_POLLS;
  readonly pollSeconds = BOOTSTRAP_VERIFY_POLL_MS / 1000;
  report: NodeBootstrapVerification | null = null;
  failure: BootstrapVerifyFailure | null = null;

  constructor(
    private bootstrapApi: BootstrapApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {this.networkSub=this.bootstrapApi.networkChanged$.subscribe(() => this.clear());}
  clear(): void {
    this.request?.unsubscribe();this.poll?.unsubscribe();this.poll=undefined;
    this.report=null;this.verifying=false;this.polling=false;this.polls=0;this.pollExhausted=false;this.failure=null;this.cdr.markForCheck();
  }
  ngOnDestroy(): void {this.clear();this.networkSub?.unsubscribe();}

  checks(report: NodeBootstrapVerification): { name: NodeBootstrapCheckName; check: NodeBootstrapCheck }[] {
    return BOOTSTRAP_VERIFICATION_CHECKS.map((name) => ({ name, check: report.checks?.[name] ?? { status: 'not-evaluated', reason: 'The run did not report this check.' } }));
  }
  stateClass(state: NodeBootstrapVerification['state']): string {
    return state === 'valid' ? 'alert-success' : state === 'invalid' ? 'alert-danger' : state === 'unavailable' ? 'alert-warning' : 'alert-info';
  }
  stateTitle(state: NodeBootstrapVerification['state']): string {
    switch (state) {
      case 'valid': return 'Every check over the bytes passed';
      case 'invalid': return 'Verification failed: do not load this snapshot';
      case 'unavailable': return 'The run could not reach an outcome';
      case 'verifying': return 'Verifying the snapshot bytes';
      default: return 'Verification pending';
    }
  }
  checkClass(status: NodeBootstrapCheck['status']): string {
    return status === 'valid' ? 'bg-success' : status === 'invalid' ? 'bg-danger' : status === 'pending' ? 'bg-info text-dark' : 'bg-secondary';
  }
  failureTitle(failure: BootstrapVerifyFailure): string {
    switch (failure.kind) {
      case 'not-found': return failure.stage === 'snapshot-not-in-catalogue' ? 'No catalogue snapshot at that height' : 'Verification run not found';
      case 'unavailable': return 'Verification source unavailable';
      case 'rejected': return 'Request rejected';
      default: return 'Request failed';
    }
  }

  verifyChecksum(): void {
    this.clear();
    const height = this.snapshotHeight;
    if (typeof height !== 'number' || !Number.isSafeInteger(height) || height < 0) {
      this.failure = { kind: 'rejected', stage: null, httpStatus: null, message: 'A nonnegative catalogue snapshot height is required.' };
      this.cdr.markForCheck();
      return;
    }
    const sha256 = this.computedSha256.trim();
    const utxoHash = this.computedUtxoHash.trim();
    if ((sha256 && !HEX64.test(sha256)) || (utxoHash && !HEX64.test(utxoHash))) {
      this.failure = { kind: 'rejected', stage: null, httpStatus: null, message: 'Checksums, when given, are 64 hexadecimal characters.' };
      this.cdr.markForCheck();
      return;
    }
    const request: BootstrapVerificationRequest = { height };
    if (sha256) request.sha256 = sha256;
    if (utxoHash) request.utxo_hash = utxoHash;
    this.verifying = true;
    this.cdr.markForCheck();

    this.request = this.bootstrapApi
      .verifySnapshotChecksum$(request)
      .subscribe({
        next: (res) => {
          this.verifying = false;
          if (!this.isRun(res)) {
            this.report = null;
            this.failure = { kind: 'other', stage: null, httpStatus: null, message: 'No verification run record was returned. Supplied hashes alone do not verify a file.' };
          } else {
            this.apply(res);
          }
          this.cdr.markForCheck();
        },
        // A check that did not run has not passed. The revision this replaces
        // set the report to valid, with a status of pinned_core_verified and a
        // block hash, so a failed request rendered as "Snapshot Commitments
        // Verified Authentic. Safe to load."
        error: (err) => {
          this.verifying = false;
          this.report = null;
          this.failure = this.classify(err);
          this.cdr.markForCheck();
        },
      });
  }

  private isRun(res: unknown): res is NodeBootstrapVerification {
    const run = res as NodeBootstrapVerification;
    return !!run && typeof run.verification_id === 'string' && typeof run.state === 'string' && run.network === this.bootstrapApi.network && !!run.checks && !!run.caller_inputs;
  }

  private classify(err: any): BootstrapVerifyFailure {
    const httpStatus = typeof err?.status === 'number' ? err.status : null;
    const stage = typeof err?.error?.stage === 'string' ? err.error.stage : null;
    const message = err?.error?.error || loadFailureMessage(classifyLoadFailure(err));
    const kind: BootstrapVerifyFailure['kind'] = httpStatus === 404 ? 'not-found' : httpStatus !== null && httpStatus >= 500 ? 'unavailable' : httpStatus !== null && httpStatus >= 400 ? 'rejected' : 'other';
    return { kind, stage, httpStatus, message };
  }

  private apply(run: NodeBootstrapVerification): void {
    this.report = run;
    if (BOOTSTRAP_TERMINAL_VERIFICATION_STATES.includes(run.state)) {
      this.poll?.unsubscribe();this.poll=undefined;this.polling=false;
      return;
    }
    if (!this.poll) {
      this.startPolling(run.verification_id);
    }
  }

  private startPolling(verificationId: string): void {
    this.polling = true;
    this.polls = 0;
    this.pollExhausted = false;
    this.poll = timer(BOOTSTRAP_VERIFY_POLL_MS, BOOTSTRAP_VERIFY_POLL_MS)
      .pipe(
        take(BOOTSTRAP_VERIFY_MAX_POLLS),
        exhaustMap(() => { this.polls++; return this.bootstrapApi.getVerification$(verificationId); })
      )
      .subscribe({
        next: (run) => {
          if (this.isRun(run) && run.verification_id === verificationId) {
            this.apply(run);
          }
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.polling = false;
          this.poll = undefined;
          this.failure = this.classify(err);
          this.cdr.markForCheck();
        },
        complete: () => {
          if (this.polling) {
            this.polling = false;
            this.pollExhausted = true;
            this.poll = undefined;
            this.cdr.markForCheck();
          }
        },
      });
  }
}
