import { rawTransactionId, validCapabilities } from './submission-validation';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  classifyLoadFailure,
  loadFailureMessage,
} from '@app/shared/load-state';
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
export function methodChoices(
  capabilities: SubmissionCapabilities | null
): MethodChoice[] {
  if (!validCapabilities(capabilities)) {
    return [];
  }
  const choices: MethodChoice[] = [];
  if (
    capabilities.privatebroadcast_tor_enabled === true &&
    capabilities.tor_active === true
  ) {
    choices.push({
      method: 'privatebroadcast_tor',
      label: 'Tor private broadcast',
      detail: capabilities.tor_active
        ? 'Tor circuit active'
        : 'Tor circuit not active',
    });
  }
  if (
    capabilities.privatebroadcast_i2p_enabled === true &&
    capabilities.i2p_active === true
  ) {
    choices.push({
      method: 'privatebroadcast_i2p',
      label: 'I2P private broadcast',
      detail: capabilities.i2p_active
        ? 'I2P router active'
        : 'I2P router not active',
    });
  }
  if (capabilities.public_p2p_enabled) {
    choices.push({
      method: 'public_p2p',
      label: 'Public P2P relay',
      detail: 'Not private: the transaction is gossiped to the public network',
    });
  }
  return choices;
}

/** Only a completed broadcast is a success; every other status is what it says. */
export function statusPresentation(status: PrivateBroadcastStatus): {
  heading: string;
  badge: string;
  tone: 'success' | 'warning' | 'danger' | 'secondary';
} {
  switch (status) {
    case 'broadcast_completed':
      return {
        heading: 'Relay reports completed; acknowledgement evidence unverified',
        badge: 'REPORTED COMPLETED',
        tone: 'secondary',
      };
    case 'queued':
      return { heading: 'Queued for relay', badge: 'QUEUED', tone: 'warning' };
    case 'acknowledged':
      return {
        heading: 'Acknowledged by relay',
        badge: 'ACKNOWLEDGED',
        tone: 'warning',
      };
    case 'aborted':
      return {
        heading: 'Broadcast aborted',
        badge: 'ABORTED',
        tone: 'secondary',
      };
    case 'failed':
      return { heading: 'Broadcast failed', badge: 'FAILED', tone: 'danger' };
    default:
      return {
        heading: 'Unknown state',
        badge: String(status).toUpperCase(),
        tone: 'secondary',
      };
  }
}

@Component({
  selector: 'app-private-submission-broadcast',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div
        class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom"
      >
        <div>
          <h1 class="h2 mb-1">Private Broadcast</h1>
          <p class="text-muted mb-0">
            Relay a raw transaction over Tor, I2P or public P2P.
          </p>
        </div>
        <a
          [routerLink]="'/mempool/submission' | relativeUrl"
          class="btn btn-outline-secondary btn-sm"
          >Back to Overview</a
        >
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
              <label
                class="form-label text-muted small text-uppercase"
                for="rawTxHex"
                >Raw Hex Transaction</label
              >
              <textarea
                id="rawTxHex"
                class="form-control bg-black text-light border-secondary font-monospace"
                rows="6"
                placeholder="02000000000101..."
                [(ngModel)]="rawTxHex"
                (ngModelChange)="reset()"
                maxlength="8000000"
              ></textarea>
            </div>

            <div class="mb-3">
              <div class="text-muted small text-uppercase mb-1">Relay path</div>
              <div
                *ngIf="!capabilities && !capabilityError"
                class="text-muted small"
              >
                Reading relay capabilities...
              </div>
              <div
                *ngIf="capabilities && choices.length === 0"
                class="text-muted small"
              >
                This deployment reports no enabled relay path.
              </div>
              <label
                class="form-check touch-check-label"
                *ngFor="let choice of choices"
              >
                <input
                  class="form-check-input"
                  type="radio"
                  name="method"
                  [value]="choice.method"
                  [(ngModel)]="method"
                  (ngModelChange)="reset()"
                />
                <span class="form-check-label"
                  >{{ choice.label }}
                  <span class="text-muted">({{ choice.detail }})</span></span
                >
              </label>
              <div *ngIf="capabilities" class="text-muted small mt-1">
                Queue: {{ capabilities.current_queue_count }} of
                {{ capabilities.queue_limit }}. Core
                {{ capabilities.core_version }}.
              </div>
            </div>

            <button
              class="btn btn-success w-100"
              (click)="submitPrivate()"
              [disabled]="!canSubmit"
            >
              {{ submitting ? 'Submitting...' : 'Submit to relay' }}
            </button>
          </div>
        </div>

        <div class="col-lg-6">
          <div
            class="card bg-dark border-secondary p-4 h-100"
            *ngIf="broadcastReceipt as receipt"
          >
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5
                class="card-title mb-0"
                [ngClass]="'text-' + presentation.tone"
              >
                {{ presentation.heading }}
              </h5>
              <span class="badge" [ngClass]="'bg-' + presentation.tone">{{
                presentation.badge
              }}</span>
            </div>

            <div class="mb-3">
              <div class="text-muted small text-uppercase">
                Submission Token
              </div>
              <code
                class="p-2 bg-black rounded text-light d-block text-break"
                >{{ receipt.submission_token }}</code
              >
            </div>
            <div class="mb-3">
              <div class="text-muted small text-uppercase">Transaction ID</div>
              <code class="p-2 bg-black rounded text-info d-block text-break">{{
                receipt.txid
              }}</code>
            </div>
            <div class="row small text-muted mb-3">
              <div class="col-6">
                Method: <span class="text-light">{{ receipt.method }}</span>
              </div>
              <div class="col-6">
                Network: <span class="text-light">{{ receipt.network }}</span>
              </div>
              <div class="col-6">
                Queued:
                <span class="text-light">{{ receipt.queued_at_utc }}</span>
              </div>
              <div class="col-6">
                Retries:
                <span class="text-light">{{ receipt.retry_count }}</span>
              </div>
            </div>
            <div
              class="alert alert-danger bg-dark border-danger small"
              *ngIf="receipt.last_error"
            >
              {{ receipt.last_error }}
            </div>

            <div class="d-flex gap-2">
              <button
                class="btn btn-outline-secondary btn-sm"
                (click)="refreshStatus()"
                [disabled]="refreshing || isTerminal(receipt.status)"
              >
                {{ refreshing ? 'Refreshing...' : 'Refresh status' }}
              </button>
              <button
                class="btn btn-outline-danger btn-sm"
                *ngIf="receipt.can_abort"
                (click)="abort()"
                [disabled]="aborting"
              >
                {{ aborting ? 'Aborting...' : 'Abort' }}
              </button>
            </div>
          </div>

          <div
            class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center"
            *ngIf="!broadcastReceipt"
          >
            <p class="text-muted mb-0">
              Paste raw transaction hex and pick a relay path.
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PrivateSubmissionBroadcastComponent implements OnInit, OnDestroy {
  rawTxHex = '';
  method: SubmissionMethod | null = null;
  capabilities: SubmissionCapabilities | null = null;
  capabilityError: string | null = null;
  choices: MethodChoice[] = [];
  submitting = false;
  refreshing = false;
  aborting = false;
  broadcastReceipt: PrivateBroadcastRecord | null = null;
  loadError: string | null = null;
  private request?: Subscription;
  private capabilityRequest?: Subscription;
  private networkSub?: Subscription;
  private expected?: {
    txid: string;
    method: SubmissionMethod;
    network: string;
    token?: string;
  };
  constructor(private api: PrivateSubmissionApiService) {}
  ngOnInit(): void {
    this.networkSub = this.api.network$.subscribe(() => {
      this.reset();
      this.capabilityRequest?.unsubscribe();
      this.capabilities = null;
      this.choices = [];
      this.method = null;
      this.capabilityError = null;
      this.capabilityRequest = this.api.getCapabilities$().subscribe({
        next: (c) => {
          if (!validCapabilities(c)) {
            this.capabilityError = 'Malformed relay capabilities.';
            return;
          }
          this.capabilities = c;
          this.choices = methodChoices(c);
          this.method = this.choices[0]?.method ?? null;
        },
        error: (e) => {
          this.capabilityError =
            e?.error?.error || loadFailureMessage(classifyLoadFailure(e));
        },
      });
    });
  }
  reset(): void {
    this.request?.unsubscribe();
    this.broadcastReceipt = null;
    this.expected = undefined;
    this.loadError = null;
    this.submitting = false;
    this.refreshing = false;
    this.aborting = false;
  }
  get canSubmit(): boolean {
    return (
      !this.submitting &&
      !this.refreshing &&
      !this.aborting &&
      !!this.rawTxHex.trim() &&
      this.method !== null &&
      this.choices.some((c) => c.method === this.method)
    );
  }
  get presentation(): ReturnType<typeof statusPresentation> {
    return statusPresentation(this.broadcastReceipt?.status ?? 'failed');
  }
  isTerminal(s: PrivateBroadcastStatus): boolean {
    return ['broadcast_completed', 'aborted', 'failed'].includes(s);
  }
  submitPrivate(): void {
    if (!this.canSubmit || !this.method) return;
    const raw = this.rawTxHex.trim(),
      method = this.method;
    this.reset();
    try {
      this.expected = {
        txid: rawTransactionId(raw),
        method,
        network: this.api.network,
      };
    } catch {
      this.loadError = 'Malformed transaction serialization.';
      return;
    }
    this.submitting = true;
    this.request = this.api.submitPrivate$({ raw_tx: raw, method }).subscribe({
      next: (r) => {
        this.broadcastReceipt = this.acceptRecord(r);
        this.submitting = false;
      },
      error: (e) => {
        this.broadcastReceipt = null;
        this.loadError =
          e?.error?.error || loadFailureMessage(classifyLoadFailure(e));
        this.submitting = false;
      },
    });
  }
  refreshStatus(): void {
    const token = this.broadcastReceipt?.submission_token;
    if (!token || !this.expected) return;
    this.request?.unsubscribe();
    this.refreshing = true;
    this.loadError = null;
    this.request = this.api.getPrivateSubmission$(token).subscribe({
      next: (r) => {
        this.broadcastReceipt = this.acceptRecord(r);
        this.refreshing = false;
      },
      error: (e) => {
        this.broadcastReceipt = null;
        this.loadError =
          e?.error?.error || loadFailureMessage(classifyLoadFailure(e));
        this.refreshing = false;
      },
    });
  }
  abort(): void {
    const token = this.broadcastReceipt?.submission_token;
    if (!token || !this.broadcastReceipt?.can_abort) return;
    this.request?.unsubscribe();
    this.refreshing = false;
    this.aborting = true;
    this.request = this.api.abortPrivate$(token).subscribe({
      next: (r) => {
        this.aborting = false;
        if (r?.success !== true || r.status !== 'aborted') {
          this.loadError = 'The relay did not confirm an abort.';
          return;
        }
        this.refreshStatus();
      },
      error: (e) => {
        this.aborting = false;
        this.loadError =
          e?.error?.error || loadFailureMessage(classifyLoadFailure(e));
      },
    });
  }
  private acceptRecord(
    r: PrivateBroadcastRecord | null | undefined
  ): PrivateBroadcastRecord | null {
    const e = this.expected;
    if (
      !r ||
      !e ||
      typeof r.submission_token !== 'string' ||
      !r.submission_token.trim() ||
      r.submission_token.length > 256 ||
      !/^[0-9a-f]{64}$/i.test(r.txid) ||
      r.txid.toLowerCase() !== e.txid ||
      r.method !== e.method ||
      r.network !== e.network ||
      this.api.network !== e.network ||
      (e.token !== undefined && r.submission_token !== e.token) ||
      ![
        'queued',
        'acknowledged',
        'aborted',
        'broadcast_completed',
        'failed',
      ].includes(r.status) ||
      typeof r.can_abort !== 'boolean' ||
      !Number.isSafeInteger(r.retry_count) ||
      r.retry_count < 0 ||
      !Number.isFinite(Date.parse(r.queued_at_utc))
    ) {
      this.loadError =
        'The relay response is not a broadcast record bound to this transaction, path, network and token.';
      return null;
    }
    e.token = r.submission_token;
    return r;
  }
  ngOnDestroy(): void {
    this.reset();
    this.capabilityRequest?.unsubscribe();
    this.networkSub?.unsubscribe();
  }
}
