import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
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
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Accelerator Receipts & Cryptographic Proof Verification</h1>
          <p class="text-muted mb-0">Independently audit miner-issued signatures confirming paid out-of-band acceleration.</p>
        </div>
        <a [routerLink]="'/mempool/submission' | relativeUrl" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-4">
        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-3">
            <h5 class="card-title mb-3">Verify Signed Accelerator Receipt</h5>
            <div class="mb-3">
              <label class="form-label text-muted small text-uppercase">Receipt JSON Payload</label>
              <textarea class="form-control bg-black text-light border-secondary font-monospace" rows="8" placeholder='{"receipt_id": "rcpt-984210", "signature": "..."}' [(ngModel)]="receiptJson"></textarea>
            </div>
            <button class="btn btn-primary w-100" (click)="verifyReceipt()" [disabled]="verifying || !receiptJson">
              {{ verifying ? 'Verifying Ed25519 / Schnorr Signature...' : 'Verify Cryptographic Receipt' }}
            </button>
          </div>
        </div>

        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-4 h-100" *ngIf="verificationResult">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="card-title text-success mb-0">Receipt Valid & Verified</h5>
              <span class="badge bg-success">SIGNATURE VALID</span>
            </div>

            <dl class="row mb-0">
              <dt class="col-sm-4 text-muted">Receipt ID</dt>
              <dd class="col-sm-8 font-monospace">{{ verificationResult.receipt_id }}</dd>

              <dt class="col-sm-4 text-muted">Provider</dt>
              <dd class="col-sm-8 fw-semibold text-info">{{ verificationResult.provider_id }}</dd>

              <dt class="col-sm-4 text-muted">Accelerated Txid</dt>
              <dd class="col-sm-8 font-monospace text-break">{{ verificationResult.txid }}</dd>

              <dt class="col-sm-4 text-muted">Paid Amount</dt>
              <dd class="col-sm-8 text-warning font-monospace">{{ verificationResult.amount_paid_sats | number }} sats</dd>

              <dt class="col-sm-4 text-muted">Timestamp</dt>
              <dd class="col-sm-8 text-muted font-monospace">{{ verificationResult.signed_timestamp }}</dd>
            </dl>
          </div>

          <div class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center" *ngIf="!verificationResult">
            <p class="text-muted mb-0">Paste receipt JSON payload to verify signature authenticity and non-repudiation.</p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class PrivateSubmissionReceiptsComponent {
  public receiptJson = '';
  public verifying = false;
  public verificationResult: any = null;
  public loadError: string | null = null;

  constructor(private api: PrivateSubmissionApiService) {}

  public verifyReceipt(): void {
    if (!this.receiptJson) return;
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
    this.api.verifyReceipt$(parsed).subscribe({
      next: res => {
        const verified = res?.verified === true && res?.signature_valid === true
          && typeof res.receipt_id === 'string' && res.receipt_id.length > 0
          && typeof res.provider_id === 'string' && res.provider_id.length > 0
          && typeof res.txid === 'string' && /^[0-9a-f]{64}$/i.test(res.txid)
          && res.receipt_id === requested.receipt_id && res.provider_id === requested.provider_id
          && res.txid.toLowerCase() === String(requested.txid).toLowerCase();
        this.verificationResult = verified ? res : null;
        if (!verified) {
          this.loadError = $localize`:@@submission.receipt.unverified:The service did not verify the signature and identity of this receipt.`;
        }
        this.verifying = false;
      },
      error: err => {
        this.verificationResult = null;
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
        this.verifying = false;
      },
    });
  }
}
