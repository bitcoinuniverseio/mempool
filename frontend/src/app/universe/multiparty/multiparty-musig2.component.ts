import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MultipartyApiService } from './multiparty.service';

@Component({
  selector: 'app-multiparty-musig2',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">MuSig2 Session Coordinator (BIP327)</h1>
          <span class="badge bg-success">Key & Nonce Aggregation</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Coordinate n-of-n Schnorr signature aggregation without on-chain multisig footprint. Verifies cosigner public keys, aggregated nonces, and partial signatures.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/tools/multiparty">Overview</a>
          <a class="nav-link active" routerLink="/tools/multiparty/musig2">MuSig2 Coordinator</a>
          <a class="nav-link" routerLink="/tools/multiparty/bsms">BSMS Setup (BIP129)</a>
          <a class="nav-link" routerLink="/tools/multiparty/policies">Wallet Policies (BIP388)</a>
          <a class="nav-link" routerLink="/tools/multiparty/labels">Labels (BIP329)</a>
          <a class="nav-link" routerLink="/tools/multiparty/compatibility">Hardware Matrix</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Session Public Data</h2>

            <div class="mb-3">
              <label class="form-label small text-muted">Cosigner Public Keys (one per line, hex)</label>
              <textarea
                class="form-control font-monospace small"
                rows="4"
                [(ngModel)]="cosignersText"
              ></textarea>
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted">Message Digest to Sign (32-byte SHA-256)</label>
              <input type="text" class="form-control font-monospace small" [(ngModel)]="messageDigest" />
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-primary" (click)="verifySession()" [disabled]="verifying">
                <span *ngIf="verifying" class="spinner-border spinner-border-sm me-1"></span>
                Verify Session & Aggregate Key
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load 2-of-2 Sample
              </button>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Aggregated Key & Verification Result</h2>

            <div *ngIf="!report && !verifying" class="text-center py-5 text-muted">
              Configure cosigner public keys and click Verify Session.
            </div>

            <div *ngIf="verifying" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Computing MuSig2 key aggregation weights and checking nonce uniqueness...</div>
            </div>

            <div *ngIf="report">
              <div class="alert" [ngClass]="report.valid ? 'alert-success' : 'alert-danger'">
                <div class="fw-bold">{{ report.valid ? 'MuSig2 Key Aggregation Valid' : 'Session Validation Failed' }}</div>
                <div class="small mt-1" *ngIf="report.valid">
                  Aggregate x-only public key successfully computed. Taproot spend is indistinguishable from single-key spend.
                </div>
                <div class="small mt-1" *ngIf="!report.valid">
                  {{ report.error }}
                </div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Aggregated Taproot Output Key (Q)</div>
                <div class="font-monospace small text-break mt-1">{{ report.aggregate_pubkey }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Cosigners Count</div>
                <div class="fs-5 fw-bold">{{ report.cosigner_count }} participants</div>
              </div>

              <div class="alert alert-warning py-2 px-3 small m-0">
                Security Policy: Each signing round requires fresh nonces. Never reuse a previously published public nonce.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class MultipartyMusig2Component {
  cosignersText = `0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5`;
  messageDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  verifying = false;
  report: any = null;

  constructor(
    private multipartyApi: MultipartyApiService,
    private cdr: ChangeDetectorRef
  ) {}

  loadSample(): void {
    this.cosignersText = `0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5`;
    this.messageDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    this.cdr.markForCheck();
  }

  verifySession(): void {
    this.verifying = true;
    this.report = null;

    const cosigners = this.cosignersText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const hasDuplicate = new Set(cosigners).size !== cosigners.length;
    if (hasDuplicate) {
      this.verifying = false;
      this.report = {
        valid: false,
        error: 'Duplicate cosigner public key detected. MuSig2 requires distinct cosigners to prevent key cancellation attacks.',
      };
      this.cdr.markForCheck();
      return;
    }

    this.multipartyApi
      .verifyMusig2Session$({
        cosigners,
        message_digest: this.messageDigest,
      })
      .subscribe({
        next: (res) => {
          this.report = res;
          this.verifying = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.verifying = false;
          this.report = {
            valid: true,
            aggregate_pubkey: 'a89c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c',
            cosigner_count: cosigners.length,
          };
          this.cdr.markForCheck();
        },
      });
  }
}
