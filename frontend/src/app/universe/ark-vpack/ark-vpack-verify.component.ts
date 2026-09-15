import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-ark-vpack-verify',
  standalone: true,
  imports: [FormsModule, RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Verify V-PACK Public Anchor</h1>
        <p class="text-muted">Read current anchor output evidence from the owned Bitcoin source and optionally compare a public descriptor commitment.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/ark/vpack' | relativeUrl">Overview</a>
          <a class="nav-link active" [routerLink]="'/ark/vpack/verify' | relativeUrl">Verify Anchor</a>
          <a class="nav-link" [routerLink]="'/ark/vpack/translate' | relativeUrl">Translate Dialect</a>
          <a class="nav-link" [routerLink]="'/ark/backups' | relativeUrl">Encrypted Backups</a>
          <a class="nav-link" [routerLink]="'/ark/exit' | relativeUrl">Unilateral Exit</a>
          <a class="nav-link" [routerLink]="'/ark/exit/simulate' | relativeUrl">Exit Simulator</a>
          <a class="nav-link" [routerLink]="'/ark/providers' | relativeUrl">ASP Registry</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Anchor Outpoint Verification</h5>
        <label for="ark-anchor">Anchor outpoint</label>
        <input id="ark-anchor" type="text" class="form-control font-monospace mb-3" placeholder="txid:vout" [(ngModel)]="outpoint" (ngModelChange)="invalidate()">
        <label for="ark-descriptor">Expected public descriptor (optional)</label>
        <textarea id="ark-descriptor" class="form-control font-monospace mb-3" [(ngModel)]="descriptor" (ngModelChange)="invalidate()" placeholder="tr(public-key,...) or wsh(...)"></textarea>
        <button class="btn btn-primary" [disabled]="loading || !outpoint.trim()" (click)="verify()">{{ loading ? 'Reading owned source…' : 'Check On-Chain Status' }}</button>
        <div *ngIf="error" class="alert alert-danger mt-3" role="alert">{{ error }}</div>
        <section *ngIf="result" class="mt-3" aria-live="polite">
          <h6>Observed output: {{ result.spend_status }}</h6>
          <p>Confirmed on-chain: {{ result.exists_onchain === null ? 'Unknown' : result.exists_onchain ? 'Yes' : 'No' }} · Confirmations: {{ result.confirmations ?? 'Unknown' }}</p>
          <p>Descriptor commitment: {{ result.commitment_matches === null ? 'Not established' : result.commitment_matches ? 'Matches output' : 'Does not match' }}</p>
          <p>Ark protocol proof: Not established · CSV exit delay: Not established</p>
          <p class="text-break font-monospace">Output script: {{ result.script_pub_key ?? 'Unknown' }}</p>
          <p class="text-break">Source: {{ result.source.network }} / {{ result.source.block_hash }} · {{ result.source.observed_at }}</p>
          <p>{{ result.verification_scope }}</p>
          <p *ngFor="let issue of result.errors" class="text-warning">{{ issue }}</p>
        </section>
      </div>
    </div>
  `,
})
export class ArkVpackVerifyComponent implements OnDestroy {
  outpoint = '';
  descriptor = '';
  loading = false;
  result: any = null;
  error: string | null = null;
  private pending?: Subscription;
  private networkSubscription: Subscription;
  private attempt = 0;
  private destroyed = false;
  constructor(private http: HttpClient, private cd: ChangeDetectorRef, private state: StateService) {
    this.networkSubscription = state.networkChanged$.subscribe(() => { this.invalidate(); this.cd.markForCheck(); });
  }
  invalidate(): void {
    this.attempt++; this.pending?.unsubscribe(); this.pending = undefined;
    this.result = null; this.error = null; this.loading = false;
  }
  private network(): string { return this.state.network || this.state.env.ROOT_NETWORK || 'mainnet'; }
  ngOnDestroy(): void { this.destroyed = true; this.invalidate(); this.networkSubscription.unsubscribe(); }
  verify(): void {
    if (this.destroyed) { return; }
    this.invalidate();
    const attempt = this.attempt, outpoint = this.outpoint.trim(), descriptor = this.descriptor.trim(), network = this.network();
    const current = () => !this.destroyed && attempt === this.attempt && outpoint === this.outpoint.trim() && descriptor === this.descriptor.trim() && network === this.network();
    this.loading = true;
    const prefix = this.state.network && this.state.network !== this.state.env.ROOT_NETWORK ? '/' + this.state.network : '';
    this.pending = this.http.post<any>(prefix + '/api/v1/intelligence/ark/vpack/public-anchors/verify', {
      anchor_outpoint: this.outpoint.trim(), ...(this.descriptor.trim() ? { expected_descriptor: this.descriptor.trim() } : {}),
    }).subscribe({ next: result => {
      if (!current()) { return; }
      if (result?.source?.network !== network || result?.anchor_outpoint?.toLowerCase() !== outpoint.toLowerCase() || !/^[0-9a-f]{64}$/.test(result?.source?.block_hash || '') || !['unspent', 'spent', 'unknown', 'invalid-output'].includes(result.spend_status)
        || !Array.isArray(result.errors) || typeof result.verification_scope !== 'string') {
        this.error = 'The anchor source returned invalid evidence.';
      } else { this.result = result; }
      this.loading = false; this.cd.markForCheck();
    }, error: response => {
      if (!current()) { return; }
      this.error = response.error?.error || 'The owned anchor source is unavailable.';
      this.loading = false; this.cd.markForCheck();
    } });
  }
}
