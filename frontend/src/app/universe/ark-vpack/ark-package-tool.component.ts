import { Component, ChangeDetectionStrategy, ChangeDetectorRef, Input, OnDestroy, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-ark-package-tool', standalone: true, imports: [CommonModule, FormsModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *ngIf="!hideInput"><label class="form-label">Package request JSON (schema 1.0 state, vpack_hex, bark_hex or arkade)</label>
    <textarea class="form-control font-monospace mb-3" rows="8" [(ngModel)]="input" (ngModelChange)="invalidate()" aria-label="V-PACK package request JSON"></textarea></ng-container>
    <ng-container *ngIf="operation.startsWith('exit/')">
      <label class="form-label">Scenario fee rate (sat/vB)</label>
      <input class="form-control mb-3" type="number" min="0.001" max="1000000" [(ngModel)]="feeRate" (ngModelChange)="invalidate()">
      <label class="form-label">Recovery address (optional, prepares an unsigned native leaf sweep)</label>
      <input class="form-control mb-3" [(ngModel)]="recoveryAddress" (ngModelChange)="invalidate()" aria-label="Recovery address">
    </ng-container>
    <button class="btn btn-primary" [disabled]="loading || !input.trim()" (click)="run()">{{ loading ? 'Reading package evidence…' : label }}</button>
    <p class="alert alert-danger mt-3" *ngIf="error" role="alert">{{ error }}</p>
    <section *ngIf="result" class="mt-3" aria-live="polite">
      <p>{{ result.verification_scope || result.scope }}</p>
      <p>Full Ark protocol verification: Not established · Exit viability: Not established</p>
      <p *ngFor="let warning of result.warnings" class="text-warning">{{ warning }}</p>
      <pre class="border rounded p-3" style="max-height:36rem;overflow:auto">{{ result | json }}</pre>
    </section>`,
})
export class ArkPackageToolComponent implements OnDestroy, OnChanges {
  @Input() operation = 'packages/reconstruct';
  @Input() label = 'Reconstruct Package';
  @Input() hideInput = false;
  @Input() input = '';
  recoveryAddress = ''; feeRate = 25; loading = false; result: any = null; error: string | null = null;
  private attempt = 0; private destroyed = false; private pending?: Subscription; private networkSubscription: Subscription;
  constructor(private http: HttpClient, private state: StateService, private cd: ChangeDetectorRef) {
    this.networkSubscription = state.networkChanged$.subscribe(() => { this.invalidate(); this.cd.markForCheck(); });
  }
  ngOnChanges(): void { this.invalidate(); }
  invalidate(): void { this.attempt++; this.pending?.unsubscribe(); this.pending = undefined; this.loading = false; this.result = null; this.error = null; }
  run(): void {
    if (this.destroyed) return;
    this.invalidate();
    const input = this.input, operation = this.operation, fee = this.feeRate, recovery = this.recoveryAddress, attempt = this.attempt;
    const network = this.state.network || this.state.env.ROOT_NETWORK || 'mainnet';
    let request: any;
    try { request = JSON.parse(input); if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error(); }
    catch { this.error = 'Supply a JSON object with state or vpack_hex.'; return; }
    if (request.network && request.network !== network) { this.error = 'Package network does not match the selected network.'; return; }
    const prefix = this.state.network && this.state.network !== this.state.env.ROOT_NETWORK ? '/' + this.state.network : '';
    this.loading = true;
    const current = () => !this.destroyed && attempt === this.attempt && input === this.input && fee === this.feeRate && recovery === this.recoveryAddress && operation === this.operation;
    this.pending = this.http.post<any>(prefix + '/api/v1/intelligence/ark/vpack/' + operation, { ...request, network, ...(operation.startsWith('exit/') ? { target_feerate_sat_vb: fee, ...(recovery ? { recovery_address: recovery } : {}) } : {}) }).subscribe({
      next: result => {
        if (!current()) return;
        if (result?.anchor?.source?.network !== network || typeof result.vtxo_id !== 'string' || result.protocol_verified !== null || result.exit_viable !== null) this.error = 'The source returned invalid package evidence.';
        else this.result = result;
        this.loading = false; this.cd.markForCheck();
      }, error: response => { if (!current()) return; this.error = response.error?.error || 'Package evidence is unavailable.'; this.loading = false; this.cd.markForCheck(); },
    });
  }
  ngOnDestroy(): void { this.destroyed = true; this.invalidate(); this.networkSubscription.unsubscribe(); }
}
