import { Subscription } from 'rxjs';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  classifyLoadFailure,
  loadFailureMessage,
} from '@app/shared/load-state';
import { PrivateSubmissionApiService } from './private-submission.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

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
            Request provider receipt signature checks. A signature alone does
            not prove payment, mining coverage or acceleration.
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
                placeholder='{"receipt_id": "rcpt-984210", "signature": "..."}'
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
                  ? 'Checking configured receipt trust...'
                  : 'Verify Cryptographic Receipt'
              }}
            </button>
          </div>
        </div>

        <div class="col-lg-6">
          <div
            class="card bg-dark border-secondary p-4 h-100"
            *ngIf="verificationResult"
          >
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="card-title text-success mb-0">Receipt response</h5>
              <span class="badge bg-success">UNVERIFIED</span>
            </div>

            <dl class="row mb-0">
              <dt class="col-sm-4 text-muted">Receipt ID</dt>
              <dd class="col-sm-8 font-monospace">
                {{ verificationResult.receipt_id }}
              </dd>

              <dt class="col-sm-4 text-muted">Provider</dt>
              <dd class="col-sm-8 fw-semibold text-info">
                {{ verificationResult.provider_id }}
              </dd>

              <dt class="col-sm-4 text-muted">Accelerated Txid</dt>
              <dd class="col-sm-8 font-monospace text-break">
                {{ verificationResult.txid }}
              </dd>

              <dt class="col-sm-4 text-muted">Declared provider fee</dt>
              <dd class="col-sm-8 text-warning font-monospace">
                {{ verificationResult.provider_fee_sats | number }} sats
              </dd>

              <dt class="col-sm-4 text-muted">Timestamp</dt>
              <dd class="col-sm-8 text-muted font-monospace">
                {{ verificationResult.submitted_at_utc }}
              </dd>
            </dl>
          </div>

          <div
            class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center"
            *ngIf="!verificationResult"
          >
            <p class="text-muted mb-0">
              Paste receipt JSON payload to verify signature authenticity and
              non-repudiation.
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
    this.verificationResult = null;
    this.loadError = null;
    this.verifying = false;
  }
  ngOnDestroy(): void {
    this.reset();
    this.networkSub?.unsubscribe();
  }
  public receiptJson = '';
  public verifying = false;
  public verificationResult: any = null;
  public loadError: string | null = null;

  constructor(private api: PrivateSubmissionApiService) {}

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
      this.verificationResult = null;
      this.loadError = $localize`:@@submission.receipt.malformed:This is not readable JSON.`;
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.verificationResult = null;
      this.loadError = $localize`:@@submission.receipt.object:Enter a receipt JSON object.`;
      return;
    }
    const requested = parsed as Record<string, unknown>;
    this.verifying = true;
    this.loadError = null;
    this.verificationResult = null;
    this.request = this.api.verifyReceipt$(parsed).subscribe({
      next: (res) => {
        this.verificationResult = null;
        this.loadError =
          'The service did not verify the receipt against an implemented authenticated provider trust contract. Payment and acceleration remain unverified.';
        this.verifying = false;
      },
      error: (err) => {
        this.verificationResult = null;
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
        this.verifying = false;
      },
    });
  }
}
