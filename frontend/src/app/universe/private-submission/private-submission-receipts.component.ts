import { Subscription } from 'rxjs';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  classifyLoadFailure,
  loadFailureMessage,
} from '@app/shared/load-state';
import {
  PrivateSubmissionApiService,
  RECEIPT_VERIFICATION_STAGES,
  ReceiptVerificationResult,
  ReceiptVerificationStage,
} from './private-submission.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/**
 * What the verifier answered: one of its typed stages with the result body,
 * whether it came as a 200 (verified), 409 (duplicate), 503
 * (unavailable-trust) or 400 (every other stage).
 */
export interface ReceiptVerdict {
  stage: ReceiptVerificationStage;
  httpStatus: number | null;
  result: ReceiptVerificationResult;
}

@Component({
  selector: 'app-private-submission-receipts',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="alert alert-warning" role="alert" *ngIf="loadError">
        {{ loadError }}
      </div>
      <div
        class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom"
      >
        <div>
          <h1 class="h2 mb-1">
            Accelerator Receipts & Cryptographic Proof Verification
          </h1>
          <p class="text-muted mb-0">
            Checks a provider receipt's signature against the key the owned
            directory holds for that provider. A verified signature proves the
            provider signed these terms; it does not prove payment, mining
            coverage or acceleration.
          </p>
        </div>
        <a
          [routerLink]="'/mempool/submission' | relativeUrl"
          class="btn btn-outline-secondary btn-sm"
          >Back to Overview</a
        >
      </div>

      <div class="row g-4">
        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-3">
            <h5 class="card-title mb-3">Verify Signed Accelerator Receipt</h5>
            <div class="mb-3">
              <label class="form-label text-muted small text-uppercase"
                >Receipt JSON Payload</label
              >
              <textarea
                class="form-control bg-black text-light border-secondary font-monospace"
                rows="8"
                placeholder='{"schema_version": "universe-accelerator-receipt-v1", "provider_id": "...", "receipt_id": "...", "txid": "...", "network": "...", "key_id": "...", "provider_signature": "..."}'
                [(ngModel)]="receiptJson"
                (ngModelChange)="reset()"
                maxlength="16384"
              ></textarea>
            </div>
            <button
              class="btn btn-primary w-100"
              (click)="verifyReceipt()"
              [disabled]="verifying || !receiptJson"
            >
              {{
                verifying
                  ? 'Checking against the owned directory...'
                  : 'Verify Cryptographic Receipt'
              }}
            </button>
          </div>
        </div>

        <div class="col-lg-6">
          <div
            class="card bg-dark border-secondary p-4 h-100"
            *ngIf="verdict as v"
          >
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="card-title mb-0" [ngClass]="v.stage === 'verified' ? 'text-success' : 'text-warning'">{{ stageTitle(v.stage) }}</h5>
              <span class="badge" [ngClass]="stageClass(v.stage)">{{ v.stage | uppercase }}</span>
            </div>

            <p class="small text-muted">{{ stageExplanation(v) }}</p>
            <ul class="small text-warning" *ngIf="v.result.errors?.length">
              <li *ngFor="let e of v.result.errors">{{ e }}</li>
            </ul>

            <dl class="row mb-0">
              <dt class="col-sm-4 text-muted">Receipt ID</dt>
              <dd class="col-sm-8 font-monospace">
                {{ v.result.receipt_id ?? requested?.receipt_id ?? 'unknown' }}
              </dd>

              <dt class="col-sm-4 text-muted">Provider</dt>
              <dd class="col-sm-8 fw-semibold text-info">
                {{ v.result.provider_id ?? requested?.provider_id ?? 'unknown' }}
              </dd>

              <dt class="col-sm-4 text-muted">Accelerated Txid</dt>
              <dd class="col-sm-8 font-monospace text-break">
                {{ requested?.txid ?? 'unknown' }}
              </dd>

              <ng-container *ngIf="v.stage === 'verified'">
                <dt class="col-sm-4 text-muted">Signing key</dt>
                <dd class="col-sm-8 font-monospace">{{ v.result.key_id }} ({{ v.result.algorithm }})</dd>

                <dt class="col-sm-4 text-muted">Verified at</dt>
                <dd class="col-sm-8 font-monospace">{{ v.result.verified_at_utc }}</dd>

                <dt class="col-sm-4 text-muted">Directory</dt>
                <dd class="col-sm-8 small">{{ v.result.directory?.source }} revision {{ v.result.directory?.revision }}, loaded {{ v.result.directory?.loaded_at_utc }}</dd>

                <dt class="col-sm-4 text-muted">Declared provider fee</dt>
                <dd class="col-sm-8 text-warning font-monospace">
                  {{ requested?.provider_fee_sats ?? 'unknown' }} sats (declared by the provider, not a payment record)
                </dd>

                <dt class="col-sm-4 text-muted">Submitted at</dt>
                <dd class="col-sm-8 text-muted font-monospace">
                  {{ requested?.submitted_at_utc ?? 'unknown' }}
                </dd>
              </ng-container>

              <ng-container *ngIf="v.stage === 'duplicate' && v.result.replay">
                <dt class="col-sm-4 text-muted">First verified</dt>
                <dd class="col-sm-8 font-monospace">{{ v.result.replay.first_verified_at_utc }}</dd>
                <dt class="col-sm-4 text-muted">Presented</dt>
                <dd class="col-sm-8 font-monospace">{{ v.result.replay.seen_count }} times</dd>
              </ng-container>
            </dl>
            <p class="small text-muted mt-3 mb-0" *ngIf="v.result.scope">{{ v.result.scope }}</p>
          </div>

          <div
            class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center"
            *ngIf="!verdict"
          >
            <p class="text-muted mb-0">
              Paste a receipt JSON payload to check its provider signature
              against the owned directory.
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PrivateSubmissionReceiptsComponent implements OnInit, OnDestroy {
  private request?: Subscription;
  private networkSub?: Subscription;
  ngOnInit(): void {
    this.networkSub = this.api.network$.subscribe(() => this.reset());
  }
  reset(): void {
    this.request?.unsubscribe();
    this.verdict = null;
    this.requested = null;
    this.loadError = null;
    this.verifying = false;
  }
  ngOnDestroy(): void {
    this.reset();
    this.networkSub?.unsubscribe();
  }
  public receiptJson = '';
  public verifying = false;
  /** The verifier's typed answer, whichever HTTP status carried it. */
  public verdict: ReceiptVerdict | null = null;
  /** The receipt as pasted; shown as the caller's input, never as the verdict. */
  public requested: Record<string, unknown> | null = null;
  public loadError: string | null = null;

  /** Kept for callers and tests: the result body only when it verified. */
  get verificationResult(): ReceiptVerificationResult | null {
    return this.verdict?.stage === 'verified' ? this.verdict.result : null;
  }

  constructor(private api: PrivateSubmissionApiService) {}

  stageTitle(stage: ReceiptVerificationStage): string {
    switch (stage) {
      case 'verified': return 'Signature verified against the owned directory';
      case 'duplicate': return 'Receipt already verified here (replay)';
      case 'unavailable-trust': return 'No trust root for this receipt';
      case 'wrong-network': return 'Receipt is for another network';
      case 'expired': return 'Receipt has expired';
      case 'unsupported': return 'Signature encoding not supported here';
      default: return 'Receipt invalid';
    }
  }

  stageClass(stage: ReceiptVerificationStage): string {
    return stage === 'verified' ? 'bg-success' : stage === 'duplicate' || stage === 'unavailable-trust' ? 'bg-warning text-dark' : 'bg-danger';
  }

  stageExplanation(verdict: ReceiptVerdict): string {
    switch (verdict.stage) {
      case 'verified': return 'The provider key named by key_id, valid at the receipt\'s issue time in the owned directory, signed exactly these terms. Payment, mining coverage and acceleration remain unverified.';
      case 'duplicate': return 'This exact receipt was verified here before; a replay is reported, not re-verified (HTTP 409).';
      case 'unavailable-trust': return 'The owned directory is absent, or the provider or key is not in it or not valid at issue. Nothing could be checked (HTTP 503).';
      case 'wrong-network': return 'The receipt names a network other than the selected one.';
      case 'expired': return 'The receipt\'s expires_at_utc has passed.';
      case 'unsupported': return 'The receipt uses an encoding this deployment cannot verify.';
      default: return 'The structure, completeness or signature failed; an altered field fails here.';
    }
  }

  private isResult(body: unknown): body is ReceiptVerificationResult {
    const r = body as ReceiptVerificationResult;
    return !!r && typeof r.verified === 'boolean' && RECEIPT_VERIFICATION_STAGES.includes(r.stage) && Array.isArray(r.errors);
  }

  public verifyReceipt(): void {
    this.reset();
    if (!this.receiptJson) return;
    if (this.receiptJson.length > 16384) {
      this.loadError = 'Receipt exceeds16KiB.';
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.receiptJson);
    } catch {
      // Unreadable input is the reader's error to see. Sending an empty body
      // instead, as the revision this replaces did, verified nothing and then
      // rendered whatever came back as the verdict on their receipt.
      this.verdict = null;
      this.loadError = $localize`:@@submission.receipt.malformed:This is not readable JSON.`;
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.verdict = null;
      this.loadError = $localize`:@@submission.receipt.object:Enter a receipt JSON object.`;
      return;
    }
    const requested = parsed as Record<string, unknown>;
    this.verifying = true;
    this.loadError = null;
    this.verdict = null;
    this.request = this.api.verifyReceipt$(parsed).subscribe({
      next: (res) => {
        this.verifying = false;
        // A 200 is only verified when the body says so with the verified
        // stage; anything else on a 200 is not a verdict this page can show.
        if (!this.isResult(res) || res.verified !== true || res.stage !== 'verified' || !res.key_id || !res.verified_at_utc) {
          this.verdict = null;
          this.loadError =
            'The service did not verify the receipt against an implemented authenticated provider trust contract. Payment and acceleration remain unverified.';
          return;
        }
        if (res.receipt_id !== undefined && res.receipt_id !== requested['receipt_id']) {
          this.verdict = null;
          this.loadError = 'The service answered for a different receipt than the one submitted; nothing is verified.';
          return;
        }
        this.requested = requested;
        this.verdict = { stage: 'verified', httpStatus: 200, result: res };
      },
      error: (err) => {
        this.verifying = false;
        const body = err?.error;
        if (this.isResult(body) && body.verified === false && body.stage !== 'verified') {
          this.requested = requested;
          this.verdict = { stage: body.stage, httpStatus: typeof err?.status === 'number' ? err.status : null, result: body };
          return;
        }
        this.verdict = null;
        this.loadError = (typeof body?.error === 'string' ? body.error : null) || loadFailureMessage(classifyLoadFailure(err));
      },
    });
  }
}
