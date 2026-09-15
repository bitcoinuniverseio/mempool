import { Component, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-verify-proof', standalone: true, imports: [CommonModule, FormsModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container-xl py-4">
      <h1>Proof and Cryptographic Verification Center</h1>
      <p>SPV inclusion is checked by the owned Bitcoin node and an independent Merkle decoder on the server. The browser does not replay the chain.</p>
      <section class="card mb-4"><div class="card-body">
        <h4>SPV Merkle Inclusion Proof</h4>
        <label for="spvTxid">Transaction ID</label>
        <input id="spvTxid" class="form-control font-monospace mb-3" [(ngModel)]="spvTxid" (ngModelChange)="invalidateSpv()">
        <label for="spvBlockHash">Block hash</label>
        <input id="spvBlockHash" class="form-control font-monospace mb-3" [(ngModel)]="spvBlockHash" (ngModelChange)="invalidateSpv()">
        <label for="spvProofHex">Raw gettxoutproof hex (for verification of an existing proof)</label>
        <textarea id="spvProofHex" rows="4" class="form-control font-monospace mb-3" [(ngModel)]="spvProofHex" (ngModelChange)="invalidateSpv()"></textarea>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-primary" [disabled]="loadingSpv || !spvTxid.trim() || !spvBlockHash.trim()" (click)="generateSpv()">Generate & Verify SPV Proof</button>
          <button class="btn btn-outline-primary" [disabled]="loadingSpv || !spvTxid.trim() || !spvProofHex.trim()" (click)="verifySpv()">Verify Raw Proof</button>
          <button class="btn btn-outline-secondary" (click)="resetSpv()">Clear</button>
        </div>
        <p *ngIf="loadingSpv" aria-live="polite">Reading owned-chain proof evidence…</p>
        <p *ngIf="spvError" class="alert alert-danger mt-3" role="alert">{{ spvError }}</p>
        <section *ngIf="spvResult" class="mt-3" aria-live="polite">
          <strong [class.text-success]="spvResult.is_valid === true" [class.text-danger]="spvResult.is_valid === false">{{ spvResult.is_valid ? 'TXID INCLUSION VERIFIED AT OWNED CHECKPOINT' : 'INVALID PROOF' }}</strong>
          <p *ngIf="spvResult.error">{{ spvResult.error }}</p>
          <p *ngIf="spvResult.is_valid">Block {{ spvResult.block_height }} · Transaction index {{ spvResult.tx_index }} · {{ spvResult.confirmations }} confirmations</p>
          <p>{{ spvResult.verification_scope }}</p>
          <p *ngIf="spvResult.nonzero_flag_padding" class="text-warning">Unused high flag bits are nonzero; Core ignores these padding bits.</p>
          <pre class="border rounded p-3" style="max-height:32rem;overflow:auto">{{ spvResult | json }}</pre>
        </section>
      </div></section>
      <section class="card"><div class="card-body">
        <h4>BIP137 / BIP322 Message Signature Verification</h4>
        <p>Message-signature verification requires a connected verifier. An unavailable verifier gives no validity verdict.</p>
        <label for="sigAddress">Address</label><input id="sigAddress" class="form-control mb-3" [(ngModel)]="sigAddress" (ngModelChange)="invalidateSig()">
        <label for="sigMessage">Message</label><textarea id="sigMessage" class="form-control mb-3" [(ngModel)]="sigMessage" (ngModelChange)="invalidateSig()"></textarea>
        <label for="sigPayload">Signature</label><textarea id="sigPayload" class="form-control font-monospace mb-3" [(ngModel)]="sigPayload" (ngModelChange)="invalidateSig()"></textarea>
        <label for="sigFormat">Format</label><select id="sigFormat" class="form-control mb-3" [(ngModel)]="sigFormat" (ngModelChange)="invalidateSig()"><option value="bip137">BIP137</option><option value="bip322_simple">BIP322 simple</option><option value="bip322_full">BIP322 full</option></select>
        <button class="btn btn-primary" [disabled]="loadingSig || !sigAddress.trim() || !sigPayload.trim()" (click)="verifySig()">Verify Signature</button>
        <button class="btn btn-outline-secondary ms-2" (click)="resetSig()">Clear</button>
        <p *ngIf="sigError" class="alert alert-danger mt-3" role="alert">{{ sigError }}</p>
        <p *ngIf="sigResult" class="mt-3">{{ sigResult.is_valid ? 'Message signature verified' : 'Invalid message signature' }}</p>
      </div></section>
    </div>`,
})
export class VerifyProofComponent implements OnDestroy {
  spvTxid = ''; spvBlockHash = ''; spvProofHex = ''; spvResult: any = null; spvError: string | null = null; loadingSpv = false;
  sigAddress = ''; sigMessage = ''; sigPayload = ''; sigFormat = 'bip322_simple'; sigResult: any = null; sigError: string | null = null; loadingSig = false;
  private spvAttempt = 0; private sigAttempt = 0; private destroyed = false;
  private spvPending?: Subscription; private sigPending?: Subscription; private networkSubscription: Subscription;
  constructor(private http: HttpClient, private state: StateService, private cdr: ChangeDetectorRef) {
    this.networkSubscription = state.networkChanged$.subscribe(() => { this.invalidateSpv(); this.invalidateSig(); this.cdr.markForCheck(); });
  }
  private network(): string { return this.state.network || this.state.env.ROOT_NETWORK || 'mainnet'; }
  private url(operation: string): string { return (this.state.network && this.state.network !== this.state.env.ROOT_NETWORK ? '/' + this.state.network : '') + '/api/v1/intelligence/verification/' + operation; }
  invalidateSpv(): void { this.spvAttempt++; this.spvPending?.unsubscribe(); this.spvPending = undefined; this.spvResult = null; this.spvError = null; this.loadingSpv = false; }
  invalidateSig(): void { this.sigAttempt++; this.sigPending?.unsubscribe(); this.sigPending = undefined; this.sigResult = null; this.sigError = null; this.loadingSig = false; }
  resetSpv(): void { this.invalidateSpv(); this.spvTxid = ''; this.spvBlockHash = ''; this.spvProofHex = ''; }
  resetSig(): void { this.invalidateSig(); this.sigAddress = ''; this.sigMessage = ''; this.sigPayload = ''; }
  generateSpv(): void { this.runSpv(false); }
  verifySpv(): void { this.runSpv(true); }
  private runSpv(raw: boolean): void {
    if (this.destroyed) return;
    this.invalidateSpv();
    const txid = this.spvTxid.trim(), block = this.spvBlockHash.trim(), bytes = this.spvProofHex.trim(), network = this.network(), attempt = this.spvAttempt;
    if (!/^[0-9a-f]{64}$/.test(txid) || ((!raw || block) && !/^[0-9a-f]{64}$/.test(block)) || raw && (!bytes || bytes.length > 1200000)) { this.spvError = 'Supply a lowercase transaction ID, a valid block hash and a bounded raw proof when verifying.'; return; }
    this.loadingSpv = true;
    const current = () => !this.destroyed && attempt === this.spvAttempt && network === this.network() && txid === this.spvTxid.trim() && block === this.spvBlockHash.trim() && bytes === this.spvProofHex.trim();
    this.spvPending = this.http.post<any>(this.url(raw ? 'verify-spv' : 'spv-proof'), { txid, ...(block ? { block_hash: block } : {}), network, ...(raw ? { proof_hex: bytes } : {}) }).subscribe({
      next: result => { if (!current()) return;
        if (result?.network !== network || typeof result.is_valid !== 'boolean' || result.is_verified !== result.is_valid || result.is_valid && (result.txid !== txid || block && result.block_hash !== block || result.source?.network !== network || result.verification_status !== 'valid' || !Number.isSafeInteger(result.tx_index) || !Number.isSafeInteger(result.block_height) || typeof result.proof_hex !== 'string' || raw && result.proof_hex !== bytes.toLowerCase())) this.spvError = 'The source returned inconsistent proof evidence.';
        else this.spvResult = result;
        this.loadingSpv = false; this.cdr.markForCheck();
      }, error: error => { if (!current()) return; this.spvError = error.error?.error || 'Proof evidence is unavailable; no verdict was established.'; this.loadingSpv = false; this.cdr.markForCheck(); },
    });
  }
  verifySig(): void {
    if (this.destroyed) return;
    this.invalidateSig();
    const address = this.sigAddress.trim(), message = this.sigMessage, signature = this.sigPayload.trim(), format = this.sigFormat, network = this.network(), attempt = this.sigAttempt;
    if (!address || !signature) return;
    this.loadingSig = true;
    const current = () => !this.destroyed && attempt === this.sigAttempt && network === this.network() && address === this.sigAddress.trim() && message === this.sigMessage && signature === this.sigPayload.trim() && format === this.sigFormat;
    this.sigPending = this.http.post<any>(this.url('verify-signature'), { address, message, signature, format, network }).subscribe({
      next: result => { if (!current()) return; if (typeof result?.is_valid !== 'boolean' || result.address !== address || result.message !== message || result.signature !== signature || result.format !== format) this.sigError = 'The source returned inconsistent signature evidence.'; else this.sigResult = result; this.loadingSig = false; this.cdr.markForCheck(); },
      error: error => { if (!current()) return; this.sigError = error.error?.error || 'Signature verifier unavailable; no signature was checked.'; this.loadingSig = false; this.cdr.markForCheck(); },
    });
  }
  ngOnDestroy(): void { this.destroyed = true; this.invalidateSpv(); this.invalidateSig(); this.networkSubscription.unsubscribe(); }
}
