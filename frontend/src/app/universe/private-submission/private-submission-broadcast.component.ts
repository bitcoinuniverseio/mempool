import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import {
  PrivateBroadcastRecord,
  PrivateBroadcastStatus,
  PrivateSubmissionApiService,
  SubmissionCapabilities,
  SubmissionMethod,
} from './private-submission.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

interface MethodChoice {
  method: SubmissionMethod;
  label: string;
  detail: string;
}

/**
 * Turns the backend's capability report into the choices a user can make.
 * Nothing is offered that the deployment did not report as enabled.
 */
export function methodChoices(capabilities: SubmissionCapabilities | null): MethodChoice[] {
  if (!capabilities) { return []; }
  const choices: MethodChoice[] = [];
  if (capabilities.privatebroadcast_tor_enabled) {
    choices.push({ method: 'privatebroadcast_tor', label: 'Tor private broadcast', detail: capabilities.tor_active ? 'Tor circuit active' : 'Tor circuit not active' });
  }
  if (capabilities.privatebroadcast_i2p_enabled) {
    choices.push({ method: 'privatebroadcast_i2p', label: 'I2P private broadcast', detail: capabilities.i2p_active ? 'I2P router active' : 'I2P router not active' });
  }
  if (capabilities.public_p2p_enabled) {
    choices.push({ method: 'public_p2p', label: 'Public P2P relay', detail: 'Not private: the transaction is gossiped to the public network' });
  }
  return choices;
}

/** Only a completed broadcast is a success; every other status is what it says. */
export function statusPresentation(status: PrivateBroadcastStatus): { heading: string; badge: string; tone: 'success' | 'warning' | 'danger' | 'secondary' } {
  switch (status) {
    case 'broadcast_completed': return { heading: 'Broadcast completed', badge: 'COMPLETED', tone: 'success' };
    case 'queued': return { heading: 'Queued for relay', badge: 'QUEUED', tone: 'warning' };
    case 'acknowledged': return { heading: 'Acknowledged by relay', badge: 'ACKNOWLEDGED', tone: 'warning' };
    case 'aborted': return { heading: 'Broadcast aborted', badge: 'ABORTED', tone: 'secondary' };
    case 'failed': return { heading: 'Broadcast failed', badge: 'FAILED', tone: 'danger' };
    default: return { heading: 'Unknown state', badge: String(status).toUpperCase(), tone: 'secondary' };
  }
}

@Component({
  selector: 'app-private-submission-broadcast',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Private Broadcast</h1>
          <p class="text-muted mb-0">Relay a raw transaction over Tor, I2P or public P2P.</p>
        </div>
        <a [routerLink]="'/mempool/submission' | relativeUrl" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="alert alert-warning" role="alert" *ngIf="capabilityError">
        <div class="fw-semibold">Private relay unavailable</div>
        <div class="small">{{ capabilityError }}</div>
      </div>
      <div class="alert alert-warning" role="alert" *ngIf="loadError">
        {{ loadError }}
      </div>

      <div class="row g-4" *ngIf="!capabilityError">
        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-3">
            <h5 class="card-title mb-3">Submit Raw Transaction</h5>
            <div class="mb-3">
              <label class="form-label text-muted small text-uppercase" for="rawTxHex">Raw Hex Transaction</label>
              <textarea id="rawTxHex" class="form-control bg-black text-light border-secondary font-monospace" rows="6" placeholder="02000000000101..." [(ngModel)]="rawTxHex"></textarea>
            </div>

            <div class="mb-3">
              <div class="text-muted small text-uppercase mb-1">Relay path</div>
              <div *ngIf="!capabilities && !capabilityError" class="text-muted small">Reading relay capabilities...</div>
              <div *ngIf="capabilities && choices.length === 0" class="text-muted small">This deployment reports no enabled relay path.</div>
              <label class="form-check touch-check-label" *ngFor="let choice of choices">
                <input class="form-check-input" type="radio" name="method" [value]="choice.method" [(ngModel)]="method">
                <span class="form-check-label">{{ choice.label }} <span class="text-muted">({{ choice.detail }})</span></span>
              </label>
              <div *ngIf="capabilities" class="text-muted small mt-1">
                Queue: {{ capabilities.current_queue_count }} of {{ capabilities.queue_limit }}. Core {{ capabilities.core_version }}.
              </div>
            </div>

            <button class="btn btn-success w-100" (click)="submitPrivate()" [disabled]="!canSubmit">
              {{ submitting ? 'Submitting...' : 'Submit to relay' }}
            </button>
          </div>
        </div>

        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-4 h-100" *ngIf="broadcastReceipt as receipt">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="card-title mb-0" [ngClass]="'text-' + presentation.tone">{{ presentation.heading }}</h5>
              <span class="badge" [ngClass]="'bg-' + presentation.tone">{{ presentation.badge }}</span>
            </div>

            <div class="mb-3">
              <div class="text-muted small text-uppercase">Submission Token</div>
              <code class="p-2 bg-black rounded text-light d-block text-break">{{ receipt.submission_token }}</code>
            </div>
            <div class="mb-3">
              <div class="text-muted small text-uppercase">Transaction ID</div>
              <code class="p-2 bg-black rounded text-info d-block text-break">{{ receipt.txid }}</code>
            </div>
            <div class="row small text-muted mb-3">
              <div class="col-6">Method: <span class="text-light">{{ receipt.method }}</span></div>
              <div class="col-6">Network: <span class="text-light">{{ receipt.network }}</span></div>
              <div class="col-6">Queued: <span class="text-light">{{ receipt.queued_at_utc }}</span></div>
              <div class="col-6">Retries: <span class="text-light">{{ receipt.retry_count }}</span></div>
            </div>
            <div class="alert alert-danger bg-dark border-danger small" *ngIf="receipt.last_error">
              {{ receipt.last_error }}
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-outline-secondary btn-sm" (click)="refreshStatus()" [disabled]="refreshing || isTerminal(receipt.status)">
                {{ refreshing ? 'Refreshing...' : 'Refresh status' }}
              </button>
              <button class="btn btn-outline-danger btn-sm" *ngIf="receipt.can_abort" (click)="abort()" [disabled]="aborting">
                {{ aborting ? 'Aborting...' : 'Abort' }}
              </button>
            </div>
          </div>

          <div class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center" *ngIf="!broadcastReceipt">
            <p class="text-muted mb-0">Paste raw transaction hex and pick a relay path.</p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class PrivateSubmissionBroadcastComponent implements OnInit, OnDestroy {
  public rawTxHex = '';
  public method: SubmissionMethod | null = null;
  public capabilities: SubmissionCapabilities | null = null;
  public capabilityError: string | null = null;
  public choices: MethodChoice[] = [];
  public submitting = false;
  public refreshing = false;
  public aborting = false;
  public broadcastReceipt: PrivateBroadcastRecord | null = null;
  public loadError: string | null = null;

  private subscriptions: Subscription[] = [];

  constructor(private api: PrivateSubmissionApiService) {}

  public ngOnInit(): void {
    this.subscriptions.push(this.api.getCapabilities$().subscribe({
      next: capabilities => {
        this.capabilities = capabilities;
        this.choices = methodChoices(capabilities);
        this.method = this.choices[0]?.method ?? null;
        this.capabilityError = null;
      },
      error: err => {
        this.capabilities = null;
        this.choices = [];
        this.method = null;
        // The backend names the missing integration in its 503 body.
        this.capabilityError = err?.error?.error || loadFailureMessage(classifyLoadFailure(err));
      },
    }));
  }

  public ngOnDestroy(): void {
    for (const subscription of this.subscriptions) { subscription.unsubscribe(); }
  }

  public get canSubmit(): boolean {
    return !this.submitting && !!this.rawTxHex.trim() && this.method !== null && this.choices.some(choice => choice.method === this.method);
  }

  public get presentation(): ReturnType<typeof statusPresentation> {
    return statusPresentation(this.broadcastReceipt?.status ?? 'failed');
  }

  public isTerminal(status: PrivateBroadcastStatus): boolean {
    return status === 'broadcast_completed' || status === 'aborted' || status === 'failed';
  }

  public submitPrivate(): void {
    if (!this.canSubmit || this.method === null) { return; }
    this.submitting = true;
    this.loadError = null;
    this.broadcastReceipt = null;
    this.subscriptions.push(this.api.submitPrivate$({ raw_tx: this.rawTxHex.trim(), method: this.method }).subscribe({
      next: record => {
        this.broadcastReceipt = this.acceptRecord(record);
        this.submitting = false;
      },
      // A submission that did not reach the relay has not been relayed.
      error: err => {
        this.broadcastReceipt = null;
        this.loadError = err?.error?.error || loadFailureMessage(classifyLoadFailure(err));
        this.submitting = false;
      },
    }));
  }

  public refreshStatus(): void {
    const token = this.broadcastReceipt?.submission_token;
    if (!token) { return; }
    this.refreshing = true;
    this.subscriptions.push(this.api.getPrivateSubmission$(token).subscribe({
      next: record => {
        this.broadcastReceipt = this.acceptRecord(record) ?? this.broadcastReceipt;
        this.refreshing = false;
      },
      error: err => {
        this.loadError = err?.error?.error || loadFailureMessage(classifyLoadFailure(err));
        this.refreshing = false;
      },
    }));
  }

  public abort(): void {
    const token = this.broadcastReceipt?.submission_token;
    if (!token) { return; }
    this.aborting = true;
    this.subscriptions.push(this.api.abortPrivate$(token).subscribe({
      next: () => {
        this.aborting = false;
        this.refreshStatus();
      },
      error: err => {
        this.loadError = err?.error?.error || loadFailureMessage(classifyLoadFailure(err));
        this.aborting = false;
      },
    }));
  }

  /** A 200 with no token, txid or known status is not a broadcast record. */
  private acceptRecord(record: PrivateBroadcastRecord | null | undefined): PrivateBroadcastRecord | null {
    const known: PrivateBroadcastStatus[] = ['queued', 'acknowledged', 'aborted', 'broadcast_completed', 'failed'];
    if (!record || typeof record.submission_token !== 'string' || typeof record.txid !== 'string' || !known.includes(record.status)) {
      this.loadError = 'The relay answered with something that is not a broadcast record.';
      return null;
    }
    return record;
  }
}
