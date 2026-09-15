import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { OffchainApiService } from './offchain.service';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-offchain-recovery',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Off-Chain Recovery Planner</h1>
          <span class="badge bg-warning text-dark">PSBT Integration</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Diagnose interrupted or abandoned statechains and CoinSwaps. Determine earliest unilateral exit heights, fee bump requirements, and generate recovery PSBT templates.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/offchain/utxo' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/offchain/statechains/operators' | relativeUrl">Statechains</a>
          <a class="nav-link" [routerLink]="'/offchain/statechains/verify' | relativeUrl">Transfer Verifier</a>
          <a class="nav-link" [routerLink]="'/offchain/coinswap' | relativeUrl">CoinSwap</a>
          <a class="nav-link" [routerLink]="'/offchain/coinswap/inspect' | relativeUrl">CoinSwap Inspector</a>
          <a class="nav-link active" [routerLink]="'/offchain/recovery' | relativeUrl">Recovery Planner</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Recovery Context</h2>

            <div class="mb-3">
              <label class="form-label small text-muted" for="offchain-recovery-protocol">Protocol Type</label>
              <select class="form-control" id="offchain-recovery-protocol" [(ngModel)]="protocolType">
                <option value="statechain">Mercury Statechain (Unilateral Exit)</option>
                <option value="coinswap">Teleport CoinSwap (Timeout Refund)</option>
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted" for="offchain-recovery-txid">Funding txid</label>
              <input type="text" class="form-control font-monospace small" id="offchain-recovery-txid" [(ngModel)]="txid" placeholder="64 hex characters" />
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted" for="offchain-recovery-locktime">Locktime height</label>
              <input type="number" class="form-control" id="offchain-recovery-locktime" [(ngModel)]="locktimeHeight" min="1" placeholder="block height" />
            </div>

            <button class="btn btn-primary w-100" (click)="generatePlan()" [disabled]="planning || !canPlan">
              <span *ngIf="planning" class="spinner-border spinner-border-sm me-1"></span>
              Compute Recovery Plan
            </button>
          </div>
        </div>

        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Actionable Recovery Steps</h2>

            <div *ngIf="loadError" class="alert alert-warning">{{ loadError }}</div>

            <div *ngIf="!plan && !planning && !loadError" class="text-center py-5 text-muted">
              Specify the deposit context to compute the recovery schedule.
            </div>

            <div *ngIf="planning" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Analyzing current blockchain tip and locktime status...</div>
            </div>

            <div *ngIf="plan">
              <div class="alert" [ngClass]="plan.recovery_state === 'recoverable_now' ? 'alert-success' : (plan.recovery_state === 'recoverable_after_height' ? 'alert-warning' : 'alert-secondary')">
                <div class="fw-bold">{{ plan.recovery_state === 'recoverable_now' ? 'Recoverable Immediately' : (plan.recovery_state === 'recoverable_after_height' ? 'Awaiting Locktime Expiration' : 'Timing Unknown') }}</div>
                <div class="small mt-1">Status: {{ plan.recovery_state }}</div>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Earliest Valid Height</div>
                    <div class="fw-bold font-monospace">{{ plan.earliest_broadcast_height ? 'Block #' + plan.earliest_broadcast_height : 'not provided' }}</div>
                  </div>
                </div>
                <div class="col-6">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Suggested Fee Rate</div>
                    <div class="fw-bold font-monospace">{{ plan.suggested_fee_rate_sats_vb !== null ? plan.suggested_fee_rate_sats_vb + ' sat/vB' : 'mempool not synced' }}</div>
                  </div>
                </div>
              </div>

              <div class="mb-3">
                <div class="text-muted small mb-1">Recovery Policy Recommendation</div>
                <div class="p-3 border rounded bg-body small">
                  {{ plan.action_guidance }}
                </div>
              </div>

              <div class="mb-3">
                <div class="text-muted small mb-1">Recovery PSBT</div>
                <div class="small p-2 border rounded bg-body text-break">
                  {{ plan.unsigned_psbt_hex || 'Built from the latest backup transaction in the PSBT Workbench; this planner does not construct one from an identifier.' }}
                </div>
              </div>

              <div class="d-flex gap-2">
                <a [routerLink]="'/tools/workbench' | relativeUrl" class="btn btn-outline-primary btn-sm">
                  Send to PSBT Workbench &rarr;
                </a>
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
export class OffchainRecoveryComponent {
  protocolType = 'statechain';
  txid = '';
  locktimeHeight: number | null = null;

  get canPlan(): boolean {
    return /^[0-9a-f]{64}$/i.test(this.txid.trim()) && Number.isInteger(this.locktimeHeight) && (this.locktimeHeight as number) > 0;
  }
  planning = false;
  plan: any = null;
  loadError: string | null = null;

  constructor(
    private offchainApi: OffchainApiService,
    private cdr: ChangeDetectorRef
  ) {}

  generatePlan(): void {
    this.planning = true;
    this.plan = null;
    this.loadError = null;

    this.offchainApi
      .getRecoveryPlan$({
        protocol: this.protocolType,
        entity_id: this.txid.trim().toLowerCase(),
        current_stage: 'latest_backup_ready',
        target_locktime: this.locktimeHeight,
      })
      .subscribe({
        next: (res) => {
          this.plan = res;
          this.planning = false;
          this.cdr.markForCheck();
        },
        // A request that failed has no plan; the earlier revision answered it
        // with an invented schedule and a constant PSBT.
        error: (err) => {
          this.planning = false;
          this.plan = null;
          this.loadError = err?.error?.error || loadFailureMessage(classifyLoadFailure(err));
          this.cdr.markForCheck();
        },
      });
  }
}
