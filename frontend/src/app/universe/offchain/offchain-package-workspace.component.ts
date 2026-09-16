import { Component, Input, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { StateService } from '@app/services/state.service';
import { OffchainApiService } from './offchain.service';
import { OFFCHAIN_SIGNED_SAMPLE } from './offchain-signed-sample';

export function publicOffchainPackage(text: string, kind: 'statechain' | 'coinswap') {
  if (text.length > 1000000) throw Error('Package exceeds the 1 MB bound.');
  const data = JSON.parse(text), field = kind === 'statechain' ? 'backup_transactions' : 'contracts';
  const profile = kind === 'statechain' ? 'bitcoin-backup-sequence-v1' : 'teleport-p2wsh-contracts-v1';
  if (!data || Array.isArray(data) || data.verification_profile !== profile || !['mainnet','testnet','testnet4','signet','regtest'].includes(data.network) || Object.keys(data).some(key => !['verification_profile','network',field].includes(key))) throw Error('Unsupported package fields/profile. Supply only the public transaction profile shown by the sample.');
  if (!Array.isArray(data[field]) || !data[field].length || data[field].length > 32) throw Error('Provide 1–32 public transaction entries.');
  const allowed = kind === 'statechain' ? ['transaction_hex','locktime'] : ['role','transaction_hex','refund_transaction_hex','redeem_script_hex'];
  for (const entry of data[field]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !allowed.includes(key))) throw Error('Unknown fields are rejected before transmission. Never paste wallet secrets.');
    for (const field of allowed.filter(key => key.endsWith('_hex'))) if (typeof entry[field] !== 'string' || !/^(?:[0-9a-f]{2}){1,100000}$/i.test(entry[field])) throw Error('Public transaction and script fields must contain bounded hex bytes.');
    if (kind === 'statechain' && entry.locktime !== undefined && (!Number.isInteger(entry.locktime) || entry.locktime <= 0)) throw Error('Invalid declared locktime.');
    if (kind === 'coinswap' && !['forward_contract','backward_contract'].includes(entry.role)) throw Error('Invalid contract role.');
  }
  return data;
}

@Component({
  selector: 'app-offchain-package-workspace', standalone: true,
  imports: [CommonModule,FormsModule,RouterModule,RelativeUrlPipe], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <h1>{{ kind === 'statechain' ? 'Statechain Transfer Verifier' : 'CoinSwap Package Inspector' }}</h1>
      <p>Verify signed public Bitcoin transactions against this explorer's owned Bitcoin node and independent script engine.</p>
      <nav class="nav nav-pills gap-2 mb-4">
        <a class="nav-link" [routerLink]="'/offchain/utxo' | relativeUrl">Overview</a>
        <a class="nav-link" [routerLink]="'/offchain/statechains/verify' | relativeUrl">Transfer Verifier</a>
        <a class="nav-link" [routerLink]="'/offchain/coinswap/inspect' | relativeUrl">CoinSwap Inspector</a>
        <a class="nav-link" [routerLink]="'/offchain/recovery' | relativeUrl">Recovery Planner</a>
      </nav>
      <div class="alert alert-info">Public transaction bytes and outpoints are sent to this explorer's backend. Enter no private keys, seed phrases or wallet files. The sample uses synthetic regtest outputs and requires the matching owned regtest node.</div>
      <div class="row g-4">
        <section class="col-lg-6">
          <label [for]="kind + '-verify-package'">Public Package JSON</label>
          <textarea class="form-control font-monospace small my-2" rows="18" [id]="kind + '-verify-package'" [(ngModel)]="packageInput" (ngModelChange)="clear()"></textarea>
          <button class="btn btn-primary me-2" (click)="verifyPackage()" [disabled]="verifying">{{ verifying ? 'Verifying…' : 'Verify Package' }}</button>
          <button class="btn btn-outline-secondary" (click)="loadSample()">Load Signed Regtest Sample</button>
        </section>
        <section class="col-lg-6" aria-live="polite">
          <h2 class="h5">Verification Findings</h2>
          <div *ngIf="error" class="alert alert-danger">{{ error }}</div>
          <ng-container *ngIf="report">
            <div class="alert" [ngClass]="report.is_valid ? 'alert-success' : 'alert-danger'">{{ report.is_valid ? 'Signed transaction profile verified' : 'Verification failed' }}</div>
            <p *ngFor="let warning of report.warnings" class="alert alert-warning">{{ warning }}</p>
            <p>{{ report.verification_scope }}</p>
            <dl>
              <dt>Owned checkpoint</dt><dd class="text-break font-monospace">{{ report.checkpoint?.network }} / {{ report.checkpoint?.block_height }} / {{ report.checkpoint?.block_hash }}</dd>
              <dt>Protocol ownership</dt><dd>Unverified</dd>
              <dt>Recovery authorization</dt><dd>{{ report.recovery_state }}</dd>
              <dt>Independent script engine</dt><dd>{{ report.script_engine }}</dd>
            </dl>
            <pre class="p-3 border rounded text-break" style="white-space: pre-wrap">{{ report.transactions | json }}</pre>
          </ng-container>
        </section>
      </div>
    </div>
  `,
})
export class OffchainPackageWorkspaceComponent implements OnDestroy {
  @Input() kind: 'statechain' | 'coinswap' = 'statechain';
  packageInput = ''; verifying = false; report: any = null; error: string | null = null;
  private request?: Subscription; private network: Subscription; private generation = 0;
  constructor(private api: OffchainApiService, private cdr: ChangeDetectorRef, state: StateService) {
    this.network = state.networkChanged$.subscribe(() => this.clear());
  }
  clear() { this.generation++; this.request?.unsubscribe(); this.verifying = false; this.report = null; this.error = null; this.cdr.markForCheck(); }
  loadSample() { this.clear(); this.packageInput = JSON.stringify(OFFCHAIN_SIGNED_SAMPLE[this.kind], null, 2); }
  verifyPackage() {
    this.clear();
    let data: any;
    try { data = publicOffchainPackage(this.packageInput, this.kind); }
    catch (error) { this.error = error instanceof SyntaxError ? 'Invalid JSON syntax.' : (error as Error).message; return; }
    this.verifying = true; const generation = this.generation;
    const operation = this.kind === 'statechain' ? this.api.verifyStatechainTransfer$(data) : this.api.verifyCoinswapPackage$(data);
    this.request = operation.subscribe({ next: result => { if(generation !== this.generation) return; this.report = result; this.verifying = false; this.cdr.markForCheck(); }, error: error => { if(generation !== this.generation) return; this.error = error?.error?.error || 'Owned-node transaction verification is unavailable.'; this.verifying = false; this.cdr.markForCheck(); } });
  }
  ngOnDestroy() { this.clear(); this.network.unsubscribe(); }
}
