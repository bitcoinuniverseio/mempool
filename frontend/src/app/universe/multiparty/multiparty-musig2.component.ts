import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { MultipartyApiService, Musig2VerificationResult } from './multiparty.service';

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
          <span class="badge badge-secondary">Public Transcript Verification</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Verify an untweaked BIP327 public transcript. Keep participants, public nonces and partial signatures in the same order. Enter public data only.
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
              <label for="musig2-keys" class="form-label small text-muted">Cosigner Public Keys (33-byte compressed hex, one per line)</label>
              <textarea
                id="musig2-keys"
                class="form-control font-monospace small"
                rows="4"
                [(ngModel)]="cosignersText"
                (ngModelChange)="clearVerification()"
              ></textarea>
            </div>

            <div class="mb-3">
              <label for="musig2-message" class="form-label small text-muted">Message Digest (32-byte hex)</label>
              <input id="musig2-message" type="text" class="form-control font-monospace small" [(ngModel)]="messageDigest" (ngModelChange)="clearVerification()" />
            </div>

            <details class="mb-3">
              <summary class="py-2">Add public nonces and partial signatures</summary>
              <div class="mt-3">
                <label for="musig2-nonces" class="form-label small text-muted">Public Nonces (66-byte hex, one per participant)</label>
                <textarea id="musig2-nonces" class="form-control font-monospace small" rows="4" [(ngModel)]="publicNoncesText" (ngModelChange)="clearVerification()"></textarea>
              </div>
              <div class="mt-3">
                <label for="musig2-partials" class="form-label small text-muted">Partial Signatures (32-byte hex, in participant order)</label>
                <textarea id="musig2-partials" class="form-control font-monospace small" rows="4" [(ngModel)]="partialSignaturesText" (ngModelChange)="clearVerification()"></textarea>
              </div>
              <div class="mt-3">
                <label for="musig2-final" class="form-label small text-muted">Final Signature (optional 64-byte hex consistency check)</label>
                <textarea id="musig2-final" class="form-control font-monospace small" rows="2" [(ngModel)]="finalSignature" (ngModelChange)="clearVerification()"></textarea>
              </div>
            </details>

            <div class="d-flex flex-wrap gap-2">
              <button class="btn btn-primary" (click)="verifySession()" [disabled]="verifying">
                <span *ngIf="verifying" class="spinner-border spinner-border-sm me-1"></span>
                Verify Public Data
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load Key Aggregation Sample
              </button>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Aggregated Key & Verification Result</h2>

            <div *ngIf="failure" class="alert alert-warning" role="alert">
              {{ failure }}
            </div>

            <div *ngIf="!report && !verifying && !failure" class="text-center py-5 text-muted">
              Configure cosigner public keys and click Verify Session.
            </div>

            <div *ngIf="verifying" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Checking the supplied public transcript...</div>
            </div>

            <div *ngIf="report">
              <div class="alert" role="status" [ngClass]="report.verified ? 'alert-success' : 'alert-info'">
                <div class="fw-bold">{{ report.verified ? 'Public transcript verified' : 'Key aggregation verified. Session incomplete.' }}</div>
                <div class="small mt-1" *ngFor="let warning of report.warnings">{{ warning }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3" *ngIf="report.aggregate_public_key">
                <div class="text-muted small">Untweaked Aggregate Public Key</div>
                <div class="font-monospace small text-break mt-1">{{ report.aggregate_public_key }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Cosigners Count</div>
                <div class="fs-5 fw-bold">{{ report.participant_count }} participants</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3" *ngIf="report.verified && report.final_signature">
                <div class="text-muted small">Verified Final Signature</div>
                <div class="font-monospace small text-break mt-1">{{ report.final_signature }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .text-muted { color: var(--u-text-muted) !important; }
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--u-brand); color: var(--u-brand-contrast); }
  `],
})
export class MultipartyMusig2Component implements OnDestroy {
  cosignersText = `0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5`;
  messageDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  publicNoncesText = '';
  partialSignaturesText = '';
  finalSignature = '';
  verifying = false;
  report: Musig2VerificationResult | null = null;
  failure: string | null = null;
  private verificationSubscription?: Subscription;

  constructor(
    private multipartyApi: MultipartyApiService,
    private cdr: ChangeDetectorRef
  ) {}

  loadSample(): void {
    this.clearVerification();
    this.cosignersText = `0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5`;
    this.messageDigest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    this.publicNoncesText = '';
    this.partialSignaturesText = '';
    this.finalSignature = '';
    this.report = null;
    this.failure = null;
    this.cdr.markForCheck();
  }

  verifySession(): void {
    this.clearVerification();
    this.verifying = true;
    this.report = null;
    this.failure = null;

    const cosigners = this.cosignersText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);

    this.verificationSubscription = this.multipartyApi
      .verifyMusig2Session$({
        participant_public_keys: cosigners,
        message_hash: this.messageDigest.trim(),
        ...(this.publicNoncesText.trim() ? { public_nonces: lines(this.publicNoncesText) } : {}),
        ...(this.partialSignaturesText.trim() ? { partial_signatures: lines(this.partialSignaturesText) } : {}),
        ...(this.finalSignature.trim() ? { final_signature: this.finalSignature.trim() } : {}),
      })
      .subscribe({
        next: (res) => {
          const complete = res?.verified === true && res.stage === 'verified-session'
            && res.nonce_aggregation_verified === true && res.final_bip340_valid === true
            && res.participant_count === cosigners.length
            && Array.isArray(res.partial_signature_validity) && res.partial_signature_validity.length === cosigners.length
            && res.partial_signature_validity.every(value => value === true)
            && /^[0-9a-f]{128}$/i.test(res.final_signature || '');
          const partial = res?.verified === false && res.stage === 'partial-session';
          if ((complete || partial) && res.scope === 'bip327-untweaked-public-transcript'
            && res.key_aggregation_verified === true && /^[0-9a-f]{64}$/i.test(res.aggregate_public_key || '')
            && res.participant_count === cosigners.length
            && Array.isArray(res.errors) && res.errors.length === 0
            && Array.isArray(res.warnings) && res.warnings.every(value => typeof value === 'string')) {
            this.report = res;
          } else {
            this.failure = 'The response did not establish a valid public verification result.';
          }
          this.verifying = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.verifying = false;
          this.report = null;
          const errors = err?.status === 400 && Array.isArray(err?.error?.errors)
            ? err.error.errors.filter((value: unknown) => typeof value === 'string').slice(0, 8) : [];
          this.failure = errors.length ? errors.join(' ') : loadFailureMessage(classifyLoadFailure(err));
          this.cdr.markForCheck();
        },
      });
  }

  clearVerification(): void {
    this.verificationSubscription?.unsubscribe();
    this.verifying = false;
    this.report = null;
    this.failure = null;
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.verificationSubscription?.unsubscribe();
  }
}
