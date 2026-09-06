import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { OpenTimestampsApiService, TimestampNetwork, TimestampVerificationResult, TimestampVerifyRequest } from './opentimestamps.service';

@Component({
  selector: 'app-opentimestamps-verify',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="alert alert-warning" role="alert" *ngIf="loadError">
        {{ loadError }}
      </div>
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Verify OpenTimestamps Proof (.ots)</h1>
          <p class="text-muted mb-0">Cryptographically evaluate Merkle branching operations up to the Bitcoin Block Header Merkle Root.</p>
        </div>
        <a routerLink="/tools/timestamp" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-4">
        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-3">
            <h5 class="card-title mb-3">Paste .ots Proof as Base64</h5>
            <div class="mb-3">
              <label for="ots-proof" class="form-label text-muted small text-uppercase">Proof Base64 Data</label>
              <textarea id="ots-proof" class="form-control bg-black text-light border-secondary font-monospace" rows="8" placeholder="BAAAAAAAb3Rz..." [(ngModel)]="proofBase64" (ngModelChange)="clearVerification()"></textarea>
            </div>
            <div class="mb-3">
              <label for="ots-digest" class="form-label">Expected file digest (optional)</label>
              <input id="ots-digest" class="form-control font-monospace" [(ngModel)]="expectedDigest" (ngModelChange)="clearVerification()" placeholder="Hexadecimal file digest" aria-describedby="ots-digest-help">
              <p id="ots-digest-help" class="small text-muted mt-2 mb-0">Use the same hash algorithm as the proof. Without a digest, verification checks only the proof's embedded digest.</p>
            </div>
            <button class="btn btn-primary w-100" (click)="verifyProof()" [disabled]="verifying || !proofBase64">
              {{ verifying ? 'Verifying Bitcoin Merkle Path...' : 'Verify Cryptographic Proof' }}
            </button>
          </div>
        </div>

        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-4 h-100" *ngIf="verificationState" role="status" aria-live="polite">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="card-title mb-0" [class.text-success]="verificationState === 'verified'">{{ resultHeading }}</h5>
              <span class="badge bg-success" *ngIf="verificationState === 'verified'">BITCOIN CONFIRMED</span>
            </div>

            <ng-container *ngIf="verificationResult as result">
            <p *ngIf="verificationState === 'verified' && result.digest_matches === true">Provided file digest matches the proof.</p>
            <p *ngIf="verificationState === 'verified' && result.digest_matches !== true">No file digest was supplied. File identity was not checked.</p>
            <p *ngIf="verificationState === 'pending'">The proof is waiting for a Bitcoin attestation. A calendar receipt does not establish Bitcoin confirmation.</p>
            <p *ngIf="verificationState === 'invalid'">The verifier rejected this proof or its requested file/network binding.</p>
            <p *ngIf="verificationState === 'unavailable'">This proof could not be verified with the available verifier and authorities.</p>
            <p *ngFor="let notice of result.notices" class="text-muted">{{ notice }}</p>
            <p *ngFor="let error of result.errors" class="text-warning">{{ error }}</p>
            <dl class="row mb-0" *ngIf="verificationState === 'verified'">
              <dt class="col-sm-4 text-muted">Bitcoin Network</dt>
              <dd class="col-sm-8">{{ result.network }}</dd>

              <dt class="col-sm-4 text-muted">Bitcoin Block Height</dt>
              <dd class="col-sm-8 fw-bold text-info">{{ result.earliest_proven_block_height }}</dd>

              <dt class="col-sm-4 text-muted">Block Hash</dt>
              <dd class="col-sm-8 font-monospace text-break">{{ result.bitcoin_block_hash }}</dd>

              <dt class="col-sm-4 text-muted">Block Timestamp</dt>
              <dd class="col-sm-8 text-light">{{ result.earliest_proven_time_utc }}</dd>

              <dt class="col-sm-4 text-muted">Attestation Type</dt>
              <dd class="col-sm-8"><span class="badge bg-secondary">{{ result.attestation_type }}</span></dd>

              <dt class="col-sm-4 text-muted">Embedded File Digest</dt>
              <dd class="col-sm-8 font-monospace text-break">{{ result.file_hash_algorithm }}: {{ result.file_digest }}</dd>

              <dt class="col-sm-4 text-muted">Operations Executed</dt>
              <dd class="col-sm-8 font-monospace">{{ result.operation_count }} step(s)</dd>
            </dl>
            </ng-container>
          </div>

          <div class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center" *ngIf="!verificationState">
            <p class="text-muted mb-0">Paste proof base64 to execute cryptographic verification against Bitcoin block headers.</p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class OpenTimestampsVerifyComponent implements OnDestroy {
  public proofBase64 = '';
  public expectedDigest = '';
  public verifying = false;
  public verificationResult: TimestampVerificationResult | null = null;
  public verificationState: 'verified' | 'pending' | 'invalid' | 'unavailable' | null = null;
  public loadError: string | null = null;
  private verificationSubscription?: Subscription;
  private readonly networkSubscription: Subscription;

  constructor(private api: OpenTimestampsApiService, private stateService: StateService) {
    this.networkSubscription = this.stateService.networkChanged$.subscribe(() => this.clearVerification());
  }

  public get resultHeading(): string {
    if (this.verificationState === 'verified') { return 'Bitcoin anchoring verified'; }
    if (this.verificationState === 'pending') { return 'Pending calendar attestation'; }
    if (this.verificationState === 'invalid') { return this.verificationResult ? 'Proof verification failed' : 'Invalid proof'; }
    return 'Verification unavailable';
  }

  public clearVerification(): void {
    this.verificationSubscription?.unsubscribe();
    this.verifying = false;
    this.verificationResult = null;
    this.verificationState = null;
    this.loadError = null;
  }

  public ngOnDestroy(): void {
    this.verificationSubscription?.unsubscribe();
    this.networkSubscription.unsubscribe();
  }

  public verifyProof(): void {
    this.clearVerification();
    if (!this.proofBase64.trim()) { return; }
    const digest = this.expectedDigest.trim().toLowerCase();
    if (digest && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(digest)) {
      this.loadError = 'Expected file digest must contain 40 or 64 hexadecimal characters, matching the proof hash algorithm.';
      return;
    }
    const network = this.stateService.network || 'mainnet';
    if (!['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(network)) {
      this.loadError = 'Select a supported Bitcoin network to verify this proof.';
      return;
    }
    const request: TimestampVerifyRequest = { proof: this.proofBase64.trim(), network: network as TimestampNetwork, ...(digest ? { digest } : {}) };
    this.verifying = true;
    this.verificationSubscription = this.api.verifyProof$(request).subscribe({
      next: res => {
        this.verifying = false;
        if (!this.isConsistentResult(res, request)) {
          this.verificationState = 'unavailable';
          this.loadError = 'The verifier returned an incomplete or inconsistent result. No proof was verified.';
          return;
        }
        this.verificationResult = res;
        this.verificationState = res.verified ? 'verified'
          : res.status === 'pending_calendar_attestation' ? 'pending'
          : ['bitcoin_attestation_invalid', 'file_mismatch', 'bitcoin_attestation_reorg', 'network_mismatch', 'conflicting_attestations'].includes(res.status)
            ? 'invalid' : 'unavailable';
      },
      error: err => {
        this.verificationResult = null;
        this.verificationState = err?.status === 400 && err?.error?.stage !== 'unsupported-operation' ? 'invalid' : 'unavailable';
        this.loadError = typeof err?.error?.error === 'string' ? err.error.error : loadFailureMessage(classifyLoadFailure(err));
        this.verifying = false;
      },
    });
  }

  private isConsistentResult(result: TimestampVerificationResult, request: TimestampVerifyRequest): boolean {
    const statuses = ['bitcoin_attestation_verified', 'pending_calendar_attestation', 'bitcoin_attestation_invalid',
      'file_mismatch', 'proof_incomplete', 'unsupported_operation', 'unsupported_attestation', 'calendar_unavailable',
      'network_mismatch', 'conflicting_attestations', 'bitcoin_attestation_reorg', 'digest_matches', 'proof_structure_valid'];
    const digestLength = ['sha1', 'ripemd160'].includes(result?.file_hash_algorithm) ? 40 : 64;
    if (!result || !statuses.includes(result.status) || typeof result.verified !== 'boolean'
      || ![null, true, false].includes(result.digest_matches)
      || !['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(result.network)
      || (result.network !== request.network && result.status !== 'network_mismatch')
      || !['sha1', 'ripemd160', 'sha256', 'keccak256'].includes(result.file_hash_algorithm)
      || typeof result.file_digest !== 'string' || result.file_digest.length !== digestLength || !/^[0-9a-f]+$/i.test(result.file_digest)
      || !Number.isSafeInteger(result.operation_count) || result.operation_count < 0
      || !Array.isArray(result.notices) || !result.notices.every(value => typeof value === 'string')
      || !Array.isArray(result.errors) || !result.errors.every(value => typeof value === 'string')
      || !Array.isArray(result.calendar_attestations)) { return false; }
    if (result.verified !== (result.status === 'bitcoin_attestation_verified')) { return false; }
    if (!result.verified) { return true; }
    return result.errors.length === 0 && result.attestation_type === 'bitcoin'
      && Number.isSafeInteger(result.earliest_proven_block_height) && result.earliest_proven_block_height >= 0
      && typeof result.bitcoin_block_hash === 'string' && /^[0-9a-f]{64}$/i.test(result.bitcoin_block_hash)
      && typeof result.earliest_proven_time_utc === 'string' && Number.isFinite(Date.parse(result.earliest_proven_time_utc))
      && (request.digest ? result.digest_matches === true && result.file_digest.toLowerCase() === request.digest : result.digest_matches === null);
  }
}
