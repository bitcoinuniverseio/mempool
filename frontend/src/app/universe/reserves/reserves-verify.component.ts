import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ReservesApiService, VerificationResult } from './reserves.service';

@Component({
  selector: 'app-reserves-verify',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Verify Proof of Reserves and Liabilities</h1>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Noncustodial proof verifier. Paste a BIP127 proof JSON package or Merkle sum tree customer inclusion path for local mathematical verification.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/intelligence/reserves">Overview</a>
          <a class="nav-link" routerLink="/intelligence/reserves/providers">Providers Directory</a>
          <a class="nav-link active" routerLink="/intelligence/reserves/verify">Verify Proof</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border">
            <div class="mb-3">
              <label class="form-label fw-bold">Proof Type</label>
              <div class="btn-group w-100" role="group">
                <button
                  type="button"
                  class="btn"
                  [ngClass]="proofType === 'bip127' ? 'btn-primary' : 'btn-outline-secondary'"
                  (click)="setProofType('bip127')"
                >
                  BIP127 Proof of Reserves
                </button>
                <button
                  type="button"
                  class="btn"
                  [ngClass]="proofType === 'merkle' ? 'btn-primary' : 'btn-outline-secondary'"
                  (click)="setProofType('merkle')"
                >
                  Merkle Liability Inclusion
                </button>
              </div>
            </div>

            <!-- BIP127 Input -->
            <div *ngIf="proofType === 'bip127'">
              <div class="mb-3">
                <label for="expectedMsg" class="form-label small text-muted">Expected Attestation Message</label>
                <input
                  type="text"
                  class="form-control font-monospace"
                  id="expectedMsg"
                  [(ngModel)]="expectedMessage"
                  placeholder="e.g. ProofOfReserves-2026-09-04"
                />
              </div>

              <div class="mb-3">
                <label for="bip127Json" class="form-label small text-muted">BIP127 Proof JSON</label>
                <textarea
                  class="form-control font-monospace small"
                  id="bip127Json"
                  rows="7"
                  [(ngModel)]="proofJson"
                  placeholder='{"items": [{"txid": "...", "vout": 0, "amount_sats": 50000000, "address": "...", "signature": "...", "public_key": "..."}]}'
                ></textarea>
              </div>
            </div>

            <!-- Merkle Input -->
            <div *ngIf="proofType === 'merkle'">
              <div class="mb-3">
                <label for="merkleRoot" class="form-label small text-muted">Expected Merkle Root</label>
                <input
                  type="text"
                  class="form-control font-monospace"
                  id="merkleRoot"
                  [(ngModel)]="merkleRoot"
                  placeholder="Root hash from snapshot"
                />
              </div>
              <div class="mb-3">
                <label for="leafHash" class="form-label small text-muted">Your Account Leaf Hash</label>
                <input
                  type="text"
                  class="form-control font-monospace"
                  id="leafHash"
                  [(ngModel)]="leafHash"
                  placeholder="Hash of your account balance & nonce"
                />
              </div>
              <div class="mb-3">
                <label for="merklePath" class="form-label small text-muted">Sibling Hashes (comma separated)</label>
                <textarea
                  class="form-control font-monospace small"
                  id="merklePath"
                  rows="4"
                  [(ngModel)]="merklePath"
                  placeholder="hash1, hash2, hash3..."
                ></textarea>
              </div>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-primary" [disabled]="verifying" (click)="verify()">
                <span class="spinner-border spinner-border-sm me-1" *ngIf="verifying"></span>
                Execute Verification
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load Sample Proof
              </button>
            </div>
          </div>
        </div>

        <!-- Verification Results -->
        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Verification Outcome</h2>

            <div *ngIf="!result" class="text-muted small py-4 text-center">
              Submit proof data to execute cryptographic verification against known Bitcoin UTXO state and Merkle tree roots.
            </div>

            <div *ngIf="result">
              <div class="alert" [ngClass]="result.verified ? 'alert-success' : 'alert-danger'">
                <h3 class="h6 alert-heading fw-bold mb-1">
                  {{ result.verified ? 'Cryptographic Verification Passed' : 'Verification Failed' }}
                </h3>
                <div class="small">
                  {{ result.verified ? 'All signatures and hashes reconcile with declared parameters.' : 'One or more mathematical constraints failed.' }}
                </div>
              </div>

              <div class="list-group list-group-flush border rounded bg-body">
                <div class="list-group-item d-flex justify-content-between">
                  <span class="text-muted small">Proof Type:</span>
                  <span class="fw-semibold text-uppercase">{{ result.proof_type }}</span>
                </div>
                <div class="list-group-item d-flex justify-content-between">
                  <span class="text-muted small">Total Verified:</span>
                  <span class="fw-bold">{{ (result.total_verified_sats / 100000000).toFixed(4) }} BTC</span>
                </div>
                <div class="list-group-item d-flex justify-content-between">
                  <span class="text-muted small">Items Count:</span>
                  <span class="fw-semibold">{{ result.verified_items_count }}</span>
                </div>
                <div class="list-group-item">
                  <span class="text-muted small d-block mb-1">Attestation Digest:</span>
                  <span class="font-monospace small text-break">{{ result.attestation_digest || 'N/A' }}</span>
                </div>
              </div>

              <div *ngIf="result.errors && result.errors.length > 0" class="mt-3">
                <div class="text-danger small fw-bold mb-1">Errors:</div>
                <ul class="text-danger small ps-3 mb-0">
                  <li *ngFor="let err of result.errors">{{ err }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .intelligence-page {
      padding: 1.5rem 1rem 3rem;
    }
  `]
})
export class ReservesVerifyComponent implements OnInit {
  public proofType: 'bip127' | 'merkle' = 'bip127';
  public expectedMessage = 'ProofOfReserves-2026-09-04';
  public proofJson = '';
  public merkleRoot = '7e8f52f360982bb8a7e025816d28c89b70b5ee682ad4e031b40280f53f669db6';
  public leafHash = '';
  public merklePath = '';

  public verifying = false;
  public result: VerificationResult | null = null;

  constructor(
    private reservesApi: ReservesApiService,
    private cd: ChangeDetectorRef,
  ) {}

  public ngOnInit(): void {
    this.loadSample();
  }

  public setProofType(type: 'bip127' | 'merkle'): void {
    this.proofType = type;
    this.result = null;
  }

  public loadSample(): void {
    if (this.proofType === 'bip127') {
      this.proofJson = JSON.stringify({
        expected_message: 'ProofOfReserves-2026-09-04',
        items: [
          {
            txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            vout: 0,
            amount_sats: 50000000,
            address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
            message: 'ProofOfReserves-2026-09-04',
            signature: '30440220...signature...',
            public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
          }
        ]
      }, null, 2);
    } else {
      this.leafHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      this.merklePath = 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb';
    }
    this.cd.markForCheck();
  }

  public verify(): void {
    this.verifying = true;
    this.result = null;

    if (this.proofType === 'bip127') {
      try {
        const parsed = JSON.parse(this.proofJson);
        this.reservesApi.verifyProof({
          proof_type: 'bip127',
          bip127_proof: {
            expected_message: this.expectedMessage,
            items: parsed.items || [],
          }
        }).subscribe({
          next: (res) => {
            this.result = res;
            this.verifying = false;
            this.cd.markForCheck();
          },
          error: (err) => {
            this.result = {
              verified: false,
              proof_type: 'bip127',
              total_verified_sats: 0,
              verified_items_count: 0,
              errors: [err?.message || 'Network error during verification'],
              attestation_digest: '',
              evaluated_at: new Date().toISOString(),
            };
            this.verifying = false;
            this.cd.markForCheck();
          }
        });
      } catch {
        this.result = {
          verified: false,
          proof_type: 'bip127',
          total_verified_sats: 0,
          verified_items_count: 0,
          errors: ['Invalid JSON in BIP127 proof field.'],
          attestation_digest: '',
          evaluated_at: new Date().toISOString(),
        };
        this.verifying = false;
        this.cd.markForCheck();
      }
    } else {
      const pathArray = this.merklePath.split(',').map(s => s.trim()).filter(s => s.length > 0);
      this.reservesApi.verifyProof({
        proof_type: 'merkle_inclusion',
        merkle_proof: {
          merkle_root: this.merkleRoot,
          leaf_hash: this.leafHash,
          path: pathArray,
          index: 0,
          expected_liability_sats: 10000000,
        }
      }).subscribe({
        next: (res) => {
          this.result = res;
          this.verifying = false;
          this.cd.markForCheck();
        },
        error: (err) => {
          this.result = {
            verified: false,
            proof_type: 'merkle_inclusion',
            total_verified_sats: 0,
            verified_items_count: 0,
            errors: [err?.message || 'Network error during verification'],
            attestation_digest: '',
            evaluated_at: new Date().toISOString(),
          };
          this.verifying = false;
          this.cd.markForCheck();
        }
      });
    }
  }
}
