import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SwapsApiService, SwapRecoveryPlan } from './swaps.service';
import { publicSwapPackage, checkRecoveryArtifact } from './swaps-package';

@Component({
  selector: 'app-swaps-recover', standalone: true, imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ['.text-muted { color: var(--u-text-muted) !important; }'],
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Swap Recovery Planner</h1>
        <p class="text-muted">Build an unsigned Bitcoin Taproot refund from a verified lockup outpoint.</p>
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle" aria-label="Swap tools">
          <a class="nav-link" [routerLink]="api.path('/swaps')">Overview</a>
          <a class="nav-link" [routerLink]="api.path('/swaps/submarine')">Submarine</a>
          <a class="nav-link" [routerLink]="api.path('/swaps/reverse')">Reverse</a>
          <a class="nav-link" [routerLink]="api.path('/swaps/chain')">Chain Swaps</a>
          <a class="nav-link" [routerLink]="api.path('/swaps/providers')">Providers</a>
          <a class="nav-link" [routerLink]="api.path('/swaps/inspect')">Inspector</a>
          <a class="nav-link active" [routerLink]="api.path('/swaps/recover')">Recovery Planner</a>
          <a class="nav-link" [routerLink]="api.path('/swaps/simulate')">Simulator</a>
        </nav>
      </header>
      <form class="card p-4 bg-body-tertiary border" (ngSubmit)="generate()">
        <h2 class="h5">Public recovery package</h2>
        <p class="text-muted small">Supports the Bitcoin two-leaf Boltz submarine/reverse script format. Public contract fields are sent to the first-party backend for node checks. Keep seeds, spending keys, invoices and preimages out of this form. Nothing is saved in browser storage.</p>
        <label for="swap-network">Bitcoin network</label>
        <select id="swap-network" class="form-control mb-3" name="network" [ngModel]="api.network" (ngModelChange)="changeNetwork($event)">
          <option value="mainnet">Mainnet</option><option value="signet">Signet</option><option value="testnet">Testnet</option><option value="testnet4">Testnet4</option><option value="regtest">Regtest</option>
        </select>
        <label for="swap-package">Public package JSON</label>
        <textarea id="swap-package" class="form-control font-monospace mb-2" rows="9" name="package" [(ngModel)]="raw" (ngModelChange)="reset()" maxlength="16384" required spellcheck="false" autocomplete="off" aria-describedby="swap-fields"></textarea>
        <p id="swap-fields" class="small text-muted">Required fields: chain, network, protocol_id, swap_type, lockup_transaction, lockup_vout, lockup_address, expected_amount_sats, preimage_hash, timeout_height, claim_public_key, refund_public_key and internal_key. Public keys use 32-byte x-only hexadecimal.</p>
        <label for="swap-file">Import public JSON file</label>
        <input id="swap-file" class="form-control mb-3" type="file" accept="application/json,.json" (change)="importFile($event)">
        <label for="swap-destination">Refund destination address</label>
        <input id="swap-destination" class="form-control mb-3" name="destination" [(ngModel)]="destination" (ngModelChange)="reset()" required autocomplete="off">
        <label for="swap-fee">Total miner fee (satoshis)</label>
        <input id="swap-fee" class="form-control mb-3" type="number" name="fee" [(ngModel)]="fee" (ngModelChange)="reset()" min="1" step="1" required>
        <button class="btn btn-primary align-self-start" type="submit" [disabled]="loading || !raw || !destination || !fee">{{ loading ? 'Checking node evidence...' : 'Generate unsigned refund PSBT' }}</button>
      </form>
      <div *ngIf="error" class="alert alert-danger mt-3" role="alert">{{ error }}</div>
      <section *ngIf="plan" class="card p-4 mt-3" aria-live="polite">
        <h2 class="h5">{{ plan.stage }}</h2>
        <p *ngFor="let note of plan.notes" class="small">{{ note }}</p>
        <p *ngIf="plan.current_block_height !== null">Node height: {{ plan.current_block_height }}. Blocks remaining: {{ plan.blocks_until_refund }}.</p>
        <p *ngIf="plan.source_context" class="small text-muted text-break">{{ plan.source_context.chain }}/{{ plan.source_context.network }} at {{ plan.source_context.block_hash }} ({{ plan.source_context.observed_at }})</p>
        <ng-container *ngIf="plan.unsigned_recovery_psbt && decoded">
          <p class="text-success">Independent browser decode passed. One unsigned input and one destination output.</p>
          <p>Refund output: {{ plan.recoverable_value_sats | number }} sats. Fee: {{ plan.estimated_miner_fee_sats | number }} sats.</p>
          <label for="swap-psbt">Unsigned PSBT (Base64)</label>
          <textarea id="swap-psbt" class="form-control font-monospace mb-3" rows="5" readonly [value]="plan.unsigned_recovery_psbt"></textarea>
          <div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-primary" type="button" (click)="copy()">Copy PSBT</button><button class="btn btn-primary" type="button" (click)="download()">Download PSBT</button><a class="btn btn-outline-secondary" [routerLink]="api.path('/tools/psbt')">Open PSBT workbench</a></div>
          <p class="small mt-2" *ngIf="copyStatus" role="status">{{ copyStatus }}</p>
        </ng-container>
      </section>
    </div>
  `,
})
export class SwapsRecoverComponent implements OnInit, OnDestroy {
  raw = ''; destination = ''; fee: number | null = null; loading = false; error = ''; decoded = false; copyStatus = '';
  plan: SwapRecoveryPlan | null = null;
  private request?: Subscription;
  private networkSub?: Subscription;
  private revision = 0;
  constructor(public api: SwapsApiService, private cdr: ChangeDetectorRef, private router: Router) {}
  ngOnInit(): void { this.networkSub = this.api.network$.subscribe(() => this.reset()); }
  reset(): void { this.revision++; this.request?.unsubscribe(); this.loading = false; this.plan = null; this.error = ''; this.decoded = false; this.copyStatus = ''; this.cdr.markForCheck(); }
  changeNetwork(network: string): void { this.reset(); this.router.navigateByUrl((network === 'mainnet' ? '' : '/' + network) + '/swaps/recover'); }
  async importFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.reset();
    if (file.size > 16384) { this.error = 'Public package file exceeds 16 KiB.'; return; }
    const revision = this.revision;
    try {
      const raw = await file.text();
      if (revision === this.revision) this.raw = raw;
    } catch {
      if (revision === this.revision) this.error = 'The public package file could not be read. Retry or paste its public JSON.';
    }
    this.cdr.markForCheck();
  }
  generate(): void {
    this.reset();
    const network = this.api.network;
    let pkg: Record<string, any>;
    try {
      pkg = { ...publicSwapPackage(this.raw, network), destination_address: this.destination.trim(), fee_sats: this.fee };
      if (!Number.isSafeInteger(this.fee) || this.fee! < 1) throw new Error('Fee must be a positive integer number of satoshis.');
    } catch (err) { this.error = err instanceof Error ? err.message : 'Invalid package.'; return; }
    this.loading = true;
    this.request = this.api.recover$(pkg, network).subscribe({
      next: ({ recovery_plan }) => {
        if (this.api.network !== network) return;
        this.loading = false;
        try {
          if (recovery_plan.unsigned_recovery_psbt) { checkRecoveryArtifact(recovery_plan, pkg, network); this.decoded = true; }
          this.plan = recovery_plan;
        } catch (err) { this.error = err instanceof Error ? err.message : 'Independent artifact decode failed.'; }
        this.cdr.markForCheck();
      },
      error: err => { this.loading = false; this.error = err.error?.error || 'The first-party recovery service is unavailable. Retry after its node connection is restored.'; this.cdr.markForCheck(); },
    });
  }
  async copy(): Promise<void> {
    if (!this.plan?.unsigned_recovery_psbt || !this.decoded) return;
    try { await navigator.clipboard.writeText(this.plan.unsigned_recovery_psbt); this.copyStatus = 'Copied.'; }
    catch { this.copyStatus = 'Clipboard unavailable. Select and copy the PSBT text above.'; }
    this.cdr.markForCheck();
  }
  download(): void {
    if (!this.plan?.unsigned_recovery_psbt || !this.decoded) return;
    const bytes = Uint8Array.from(atob(this.plan.unsigned_recovery_psbt), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = 'unsigned-swap-refund.psbt'; link.click(); URL.revokeObjectURL(url);
  }
  ngOnDestroy(): void { this.revision++; this.request?.unsubscribe(); this.networkSub?.unsubscribe(); }
}
