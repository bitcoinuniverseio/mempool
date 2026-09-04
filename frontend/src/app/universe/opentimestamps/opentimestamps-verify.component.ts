import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { OpenTimestampsApiService } from './opentimestamps.service';

@Component({
  selector: 'app-opentimestamps-verify',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Verify OpenTimestamps Proof (.ots)</h1>
          <p class="text-muted mb-0">Cryptographically evaluate Merkle branching operations up to the Bitcoin Block Header Merkle Root.</p>
        </div>
        <a routerLink="/tools/timestamp" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-4">
        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-3">
            <h5 class="card-title mb-3">Upload or Paste .ots File / Base64</h5>
            <div class="mb-3">
              <label class="form-label text-muted small text-uppercase">Proof Base64 Data</label>
              <textarea class="form-control bg-black text-light border-secondary font-monospace" rows="8" placeholder="BAAAAAAAb3Rz..." [(ngModel)]="proofBase64"></textarea>
            </div>
            <button class="btn btn-primary w-100" (click)="verifyProof()" [disabled]="verifying || !proofBase64">
              {{ verifying ? 'Verifying Bitcoin Merkle Path...' : 'Verify Cryptographic Proof' }}
            </button>
          </div>
        </div>

        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-4 h-100" *ngIf="verificationResult">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="card-title text-success mb-0">Proof Verified Successfully</h5>
              <span class="badge bg-success">BITCOIN CONFIRMED</span>
            </div>

            <dl class="row mb-0">
              <dt class="col-sm-4 text-muted">Bitcoin Block Height</dt>
              <dd class="col-sm-8 fw-bold text-info">{{ verificationResult.bitcoin_block_height }}</dd>

              <dt class="col-sm-4 text-muted">Block Hash</dt>
              <dd class="col-sm-8 font-monospace text-break">{{ verificationResult.bitcoin_block_hash }}</dd>

              <dt class="col-sm-4 text-muted">Block Timestamp</dt>
              <dd class="col-sm-8 text-light">{{ verificationResult.bitcoin_block_time }}</dd>

              <dt class="col-sm-4 text-muted">Attestation Type</dt>
              <dd class="col-sm-8"><span class="badge bg-secondary">{{ verificationResult.attestation_type }}</span></dd>

              <dt class="col-sm-4 text-muted">Operations Executed</dt>
              <dd class="col-sm-8 font-monospace">{{ verificationResult.proof_operations_count }} step(s)</dd>
            </dl>
          </div>

          <div class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center" *ngIf="!verificationResult">
            <p class="text-muted mb-0">Paste proof base64 to execute cryptographic verification against Bitcoin block headers.</p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class OpenTimestampsVerifyComponent {
  public proofBase64 = 'BAAAAAAAb3RzLXByb29m-mock-base64-data';
  public verifying = false;
  public verificationResult: any = null;

  constructor(private api: OpenTimestampsApiService) {}

  public verifyProof(): void {
    if (!this.proofBase64) return;
    this.verifying = true;
    this.api.verifyProof$({ proof: this.proofBase64 }).subscribe(res => {
      this.verificationResult = res;
      this.verifying = false;
    });
  }
}
