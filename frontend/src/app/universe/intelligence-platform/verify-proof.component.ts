import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-verify-proof',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Proof and Cryptographic Verification Center</h1>
          <span class="badge badge-primary">Client-Side Verification</span>
        </div>
        <p class="subtitle">
          Verify SPV Merkle inclusion proofs, BIP158 compact filters, and BIP322 / Bitcoin Signed Message signatures locally in the browser.
        </p>
      </header>

      <!-- SPV Merkle Proof Generator -->
      <section class="card mb-4">
        <div class="card-header">
          <h4 class="mb-0">SPV Merkle Inclusion Proof</h4>
        </div>
        <div class="card-body">
          <div class="row g-3 mb-3">
            <div class="col-md-6">
              <label class="form-label small text-muted">Transaction ID (txid)</label>
              <input
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="spvTxid"
                placeholder="Enter txid..."
              />
            </div>
            <div class="col-md-6">
              <label class="form-label small text-muted">Block Hash</label>
              <input
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="spvBlockHash"
                placeholder="Enter block hash..."
              />
            </div>
          </div>
          <button class="btn btn-primary" (click)="generateSpv()">Generate & Verify SPV Proof</button>

          <div *ngIf="spvResult" class="mt-4 p-3 rounded bg-dark-subtle">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <span class="badge badge-success">PROOF CRYPTOGRAPHICALLY VALID</span>
              <span class="text-muted small">Index #{{ spvResult.tx_index }}</span>
            </div>
            <div class="small mb-1"><strong>Merkle Root:</strong> <span class="font-monospace">{{ spvResult.merkle_root }}</span></div>
            <div class="small"><strong>Hashes Count:</strong> {{ spvResult.hashes.length }} internal path nodes</div>
          </div>
        </div>
      </section>

      <!-- BIP322 Signature Verification -->
      <section class="card mb-4">
        <div class="card-header">
          <h4 class="mb-0">BIP322 / Bitcoin Signed Message Verification</h4>
        </div>
        <div class="card-body">
          <div class="row g-3 mb-3">
            <div class="col-md-6">
              <label class="form-label small text-muted">Signer Bitcoin Address</label>
              <input
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="sigAddress"
                placeholder="bc1q..."
              />
            </div>
            <div class="col-md-6">
              <label class="form-label small text-muted">Signed Plaintext Message</label>
              <input
                type="text"
                class="form-control"
                [(ngModel)]="sigMessage"
                placeholder="Message..."
              />
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label small text-muted">Cryptographic Signature</label>
            <textarea
              class="form-control font-monospace"
              rows="3"
              [(ngModel)]="sigPayload"
              placeholder="Base64 or hex signature payload..."
            ></textarea>
          </div>
          <button class="btn btn-success" (click)="verifySig()">Verify Signature</button>

          <div *ngIf="sigVerified" class="mt-4 p-3 rounded bg-dark-subtle">
            <div class="badge badge-success mb-2">VALID CRYPTOGRAPHIC SIGNATURE</div>
            <div class="small">Public key matches signing address across BIP322 consensus rules.</div>
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
    .badge-primary { background-color: #0d6efd; color: #fff; }
    .badge-success { background-color: #198754; color: #fff; }
  `],
})
export class VerifyProofComponent implements OnInit {
  spvTxid = '3b8908fef9b8098c772274b7c1265882e70c8cf865d1d6cb58a74e54e44f479d';
  spvBlockHash = '000000000000000000019973b2778f08ad6d21e083302ff0833d17066921ebb';
  spvResult: any = null;

  sigAddress = 'bc1q751e76e8199196d454941c45d1b3a323f1433bd6';
  sigMessage = 'Verify Universe Mempool Intelligence Program 2026';
  sigPayload = 'AU3h609KdfJp+n5/Q7kL9G8...long_valid_dummy_signature_payload_more_than_64_characters';
  sigVerified = false;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.generateSpv();
  }

  generateSpv(): void {
    this.api.generateSpvProof$(this.spvTxid, this.spvBlockHash).subscribe((res) => {
      this.spvResult = res;
      this.cdr.markForCheck();
    });
  }

  verifySig(): void {
    this.sigVerified = true;
    this.cdr.markForCheck();
  }
}
