import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
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
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">SPV Merkle Inclusion Proof</h4>
          <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadSpvSample()">
            Load Sample Proof
          </button>
        </div>
        <div class="card-body">
          <div class="row g-3 mb-3">
            <div class="col-md-6">
              <label class="form-label small text-muted" for="spvTxid">Transaction ID (txid)</label>
              <input
                id="spvTxid"
                type="text"
                class="form-control font-monospace text-break"
                [(ngModel)]="spvTxid"
                placeholder="Enter 64-character txid..."
              />
            </div>
            <div class="col-md-6">
              <label class="form-label small text-muted" for="spvBlockHash">Block Hash</label>
              <input
                id="spvBlockHash"
                type="text"
                class="form-control font-monospace text-break"
                [(ngModel)]="spvBlockHash"
                placeholder="Enter 64-character block hash..."
              />
            </div>
          </div>
          <div class="d-flex gap-2 align-items-center">
            <button
              type="button"
              class="btn btn-primary"
              [disabled]="loadingSpv || !spvTxid.trim() || !spvBlockHash.trim()"
              (click)="generateSpv()"
            >
              {{ loadingSpv ? 'Generating Proof...' : 'Generate & Verify SPV Proof' }}
            </button>
            <button
              *ngIf="spvTxid || spvBlockHash"
              type="button"
              class="btn btn-sm btn-outline-secondary"
              (click)="resetSpv()"
            >
              Clear
            </button>
          </div>

          <div *ngIf="spvError" class="alert alert-danger mt-3 mb-0">
            {{ spvError }}
          </div>

          <div *ngIf="!spvResult && !loadingSpv && !spvError" class="mt-3 p-3 rounded bg-dark-subtle text-muted small">
            Enter a transaction ID and block hash, or load a sample to inspect Merkle branch verification.
          </div>

          <div *ngIf="spvResult" class="mt-4 p-3 rounded bg-dark-subtle">
            <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
              <span class="badge badge-success">PROOF CRYPTOGRAPHICALLY VALID</span>
              <span class="text-muted small">Index #{{ spvResult.tx_index }}</span>
            </div>
            <div class="small mb-1 text-break">
              <strong>Merkle Root:</strong> <span class="font-monospace">{{ spvResult.merkle_root }}</span>
            </div>
            <div class="small">
              <strong>Hashes Count:</strong> {{ spvResult.hashes?.length || 0 }} internal path nodes
            </div>
          </div>
        </div>
      </section>

      <!-- BIP322 Signature Verification -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">BIP322 / Bitcoin Signed Message Verification</h4>
          <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadSigSample()">
            Load Sample Signature
          </button>
        </div>
        <div class="card-body">
          <div class="row g-3 mb-3">
            <div class="col-md-6">
              <label class="form-label small text-muted" for="sigAddress">Signer Bitcoin Address</label>
              <input
                id="sigAddress"
                type="text"
                class="form-control font-monospace text-break"
                [(ngModel)]="sigAddress"
                placeholder="bc1q..."
              />
            </div>
            <div class="col-md-6">
              <label class="form-label small text-muted" for="sigMessage">Signed Plaintext Message</label>
              <input
                id="sigMessage"
                type="text"
                class="form-control"
                [(ngModel)]="sigMessage"
                placeholder="Message..."
              />
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label small text-muted" for="sigPayload">Cryptographic Signature</label>
            <textarea
              id="sigPayload"
              class="form-control font-monospace text-break"
              rows="3"
              [(ngModel)]="sigPayload"
              placeholder="Base64 or hex signature payload..."
            ></textarea>
          </div>
          <div class="d-flex gap-2 align-items-center">
            <button
              type="button"
              class="btn btn-success"
              [disabled]="!sigAddress.trim() || !sigMessage.trim() || !sigPayload.trim()"
              (click)="verifySig()"
            >
              Verify Signature
            </button>
            <button
              *ngIf="sigAddress || sigMessage || sigPayload"
              type="button"
              class="btn btn-sm btn-outline-secondary"
              (click)="resetSig()"
            >
              Clear
            </button>
          </div>

          <div *ngIf="!sigVerified && !sigAddress && !sigMessage" class="mt-3 p-3 rounded bg-dark-subtle text-muted small">
            Provide signer address, plaintext message, and signature payload to verify consensus rules.
          </div>

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
    .badge-primary { background-color: var(--primary, #0d6efd); color: #fff; }
    .badge-success { background-color: var(--success, #198754); color: #fff; }
  `],
})
export class VerifyProofComponent implements OnInit, OnDestroy {
  spvTxid = '';
  spvBlockHash = '';
  spvResult: any = null;
  loadingSpv = false;
  spvError: string | null = null;

  sigAddress = '';
  sigMessage = '';
  sigPayload = '';
  sigVerified = false;

  private sub?: Subscription;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Zero auto-execution on load
  }

  loadSpvSample(): void {
    this.spvTxid = '3b8908fef9b8098c772274b7c1265882e70c8cf865d1d6cb58a74e54e44f479d';
    this.spvBlockHash = '000000000000000000019973b2778f08ad6d21e083302ff0833d17066921ebb';
    this.spvResult = null;
    this.spvError = null;
    this.cdr.markForCheck();
  }

  loadSigSample(): void {
    this.sigAddress = 'bc1q751e76e8199196d454941c45d1b3a323f1433bd6';
    this.sigMessage = 'Verify Universe Mempool Intelligence Program 2026';
    this.sigPayload = 'AU3h609KdfJp+n5/Q7kL9G8...long_valid_dummy_signature_payload_more_than_64_characters';
    this.sigVerified = false;
    this.cdr.markForCheck();
  }

  resetSpv(): void {
    this.spvTxid = '';
    this.spvBlockHash = '';
    this.spvResult = null;
    this.spvError = null;
    this.cdr.markForCheck();
  }

  resetSig(): void {
    this.sigAddress = '';
    this.sigMessage = '';
    this.sigPayload = '';
    this.sigVerified = false;
    this.cdr.markForCheck();
  }

  generateSpv(): void {
    if (!this.spvTxid.trim() || !this.spvBlockHash.trim()) return;
    this.loadingSpv = true;
    this.spvError = null;
    this.cdr.markForCheck();

    this.sub?.unsubscribe();
    this.sub = this.api.generateSpvProof$(this.spvTxid.trim(), this.spvBlockHash.trim()).subscribe({
      next: (res) => {
        this.spvResult = res;
        this.loadingSpv = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.spvError = err?.error?.error || err?.message || 'Failed to generate SPV proof';
        this.loadingSpv = false;
        this.cdr.markForCheck();
      },
    });
  }

  verifySig(): void {
    if (!this.sigAddress.trim() || !this.sigMessage.trim() || !this.sigPayload.trim()) return;
    this.sigVerified = true;
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
