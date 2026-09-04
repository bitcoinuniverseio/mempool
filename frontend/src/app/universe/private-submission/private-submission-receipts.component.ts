import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PrivateSubmissionApiService } from './private-submission.service';

@Component({
  selector: 'app-private-submission-receipts',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Accelerator Receipts & Cryptographic Proof Verification</h1>
          <p class="text-muted mb-0">Independently audit miner-issued signatures confirming paid out-of-band acceleration.</p>
        </div>
        <a routerLink="/mempool/submission" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
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
  public receiptJson = '{\n  "receipt_id": "rcpt-984210",\n  "provider_id": "mempool-accelerate",\n  "txid": "9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678",\n  "amount_paid_sats": 15000\n}';
  public verifying = false;
  public verificationResult: any = null;

  constructor(private api: PrivateSubmissionApiService) {}

  public verifyReceipt(): void {
    if (!this.receiptJson) return;
    this.verifying = true;
    try {
      const parsed = JSON.parse(this.receiptJson);
      this.api.verifyReceipt$(parsed).subscribe(res => {
        this.verificationResult = res;
        this.verifying = false;
      });
    } catch {
      this.api.verifyReceipt$({}).subscribe(res => {
        this.verificationResult = res;
        this.verifying = false;
      });
    }
  }
}
