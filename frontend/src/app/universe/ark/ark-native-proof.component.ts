import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, finalize } from 'rxjs';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '../universe-api.service';
import { ArkOperator } from '../universe.types';
import { formatAtomicAmount } from '../universe-evidence';
import { ArkNativeProofVerdict, ArkNativeProofInput, ArkNativeObservation, readArkProof, readArkSource, readArkVerdict } from './ark-native-view';

@Component({
  selector: 'app-ark-native-proof', standalone: true, imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h2>Verify a native Ark proof package</h2>
      <p>Supply the complete public signed PSBT tree and DefaultVtxo policy for an observed Signet provider. A hash array cannot establish native membership or signatures.</p>
      <label for="ark-native-proof-json">Versioned public proof JSON</label>
      <textarea id="ark-native-proof-json" class="form-control" rows="8" [ngModel]="text" (ngModelChange)="edit($event)"
        [ngModelOptions]="{standalone:true}" placeholder="universe-ark-native-proof-v1"></textarea>
      <p>Verification needs an independently observed provider identity. Do not paste private keys or wallet credentials.</p>
      <button class="btn btn-primary" (click)="verify()" [disabled]="pending || !text.trim() || !available">Verify native proof</button>
      <button class="btn btn-outline-secondary ms-2" (click)="clear()" [disabled]="!text && !pending && !verdict && !error">Clear proof</button>
      <p *ngIf="!available">Native verification is unavailable until the selected Signet provider identity is observed.</p>
      <p *ngIf="pending" role="status" aria-live="polite">Checking native membership, original PSBTs and signatures...</p>
      <p *ngIf="error" class="alert alert-warning" role="alert">{{ error }}</p>
      <ng-container *ngIf="verdict">
        <h3>{{ verdict.valid === true ? 'Native proof verified within the stated scope' : verdict.valid === false ? 'Native proof invalid' : 'Native verifier unavailable' }}</h3>
        <p *ngIf="verdict.error" role="alert">{{ verdict.error }}</p>
        <p>Unilateral exit viability: Unknown. Whole protocol verification: Unknown.</p>
        <p>{{ verdict.scope }}</p>
        <p class="mono">Submitted package SHA-256: {{ packageDigest }}</p>
        <ng-container *ngIf="verdict.evidence as evidence">
          <p class="mono">Batch: {{ evidence.batchOutpoint }}. VTXO: {{ evidence.vtxoOutpoint }}.</p>
          <p>Observed amount: {{ formatAtomicAmount(evidence.amountAtomic,8) }} BTC ({{ evidence.amountAtomic }} sats).</p>
          <p>Observed expiry: {{ evidence.expiryUnixSeconds }} Unix seconds. Future exit execution remains unverified.</p>
          <p class="mono">Provider: {{ verdict.source?.profile?.providerId }}. Source profile: {{ verdict.source?.profileSha256 }}.</p>
          <p class="mono">Observed checkpoint: {{ verdict.source?.anchor?.height }} / {{ verdict.source?.anchor?.hash }} at {{ verdict.source?.observedAt }}.</p>
          <p *ngFor="let digest of evidence.nativePsbtSha256; index as i" class="mono">Original signed PSBT {{ i + 1 }} SHA-256: {{ digest }}</p>
        </ng-container>
      </ng-container>
    </section>`,
})
export class ArkNativeProofComponent implements OnInit, OnChanges, OnDestroy {
  @Input() operators: ArkOperator[] = [];
  text = ''; pending = false; error: string | null = null; verdict: ArkNativeProofVerdict | null = null; packageDigest = '';
  protected readonly formatAtomicAmount = formatAtomicAmount;
  private readonly api = inject(UniverseApiService);
  private readonly state = inject(StateService);
  private readonly cd = inject(ChangeDetectorRef);
  private active = new Subscription(); private networkSubscription = new Subscription();
  private revision = 0; private destroyed = false;
  get network(): string {return this.state.network || this.state.env.ROOT_NETWORK || 'mainnet';}
  get available(): boolean {return this.network === 'signet' && this.operators.some(operator => {
    try {return readArkSource(operator.source, this.network).profile.providerId === operator.id;} catch {return false;}
  });}
  ngOnInit(): void {this.networkSubscription = this.state.networkChanged$.subscribe(() => this.clear());}
  ngOnChanges(): void {this.invalidate();}
  private invalidate(): void {this.revision++; this.active.unsubscribe(); this.pending = false; this.error = null; this.verdict = null; this.packageDigest = ''; this.cd.markForCheck();}
  edit(text: string): void {this.invalidate(); this.text = text;}
  clear(): void {this.invalidate(); this.text = '';}
  verify(): void {
    if (this.destroyed || this.pending) {return;}
    let request: ArkNativeProofInput, selected: ArkNativeObservation;
    try {
      request = readArkProof(this.text, this.network);
      const provider = this.operators.find(operator => operator.id === request.providerId);
      selected = readArkSource(provider?.source, this.network);
      if (selected.profile.providerId !== request.providerId) {throw Error('Select a proof from the observed provider.');}
    } catch (error) {this.verdict = null; this.error = error instanceof Error ? error.message : 'Invalid native proof input.'; this.cd.markForCheck(); return;}
    const revision = ++this.revision;
    this.verdict = null; this.error = null; this.pending = true;
    this.packageDigest = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(request))));
    const accept = (value: unknown): void => {
      if (this.destroyed || revision !== this.revision) {return;}
      try {this.verdict = readArkVerdict(value, request, selected);}
      catch (error) {this.error = error instanceof Error ? error.message : 'Native proof response could not be validated.';}
      this.cd.markForCheck();
    };
    this.active = this.api.verifyArkNativeProof$(request).pipe(finalize(() => {
      if (!this.destroyed && revision === this.revision) {this.pending = false; this.cd.markForCheck();}
    })).subscribe({next: accept, error: error => {
      if (this.destroyed || revision !== this.revision) {return;}
      if (error?.error?.schema === 'universe-ark-native-proof-verdict-v1') {accept(error.error);}
      else {this.error = typeof error?.error?.error === 'string' ? error.error.error : 'Native proof source unavailable or bounded verification deadline exceeded. Retry or clear the package.'; this.cd.markForCheck();}
    }});
  }
  ngOnDestroy(): void {this.destroyed = true; this.invalidate(); this.networkSubscription.unsubscribe();}
}
