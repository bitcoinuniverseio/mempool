import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { OffchainApiService } from './offchain.service';

@Component({
  selector: 'app-offchain-recovery',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
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
          <a class="nav-link" routerLink="/offchain/utxo">Overview</a>
          <a class="nav-link" routerLink="/offchain/statechains/operators">Statechains</a>
          <a class="nav-link" routerLink="/offchain/statechains/verify">Transfer Verifier</a>
          <a class="nav-link" routerLink="/offchain/coinswap">CoinSwap</a>
          <a class="nav-link" routerLink="/offchain/coinswap/inspect">CoinSwap Inspector</a>
          <a class="nav-link active" routerLink="/offchain/recovery">Recovery Planner</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Recovery Context</h2>

            <div class="mb-3">
              <label class="form-label small text-muted">Protocol Type</label>
              <select class="form-select" [(ngModel)]="protocolType">
                <option value="statechain">Mercury Statechain (Unilateral Exit)</option>
                <option value="coinswap">Teleport CoinSwap (Timeout Refund)</option>
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted">Deposit / Funding TxID</label>
              <input type="text" class="form-control font-monospace small" [(ngModel)]="txid" />
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted">Locktime Height</label>
              <input type="number" class="form-control" [(ngModel)]="locktimeHeight" />
            </div>

            <button class="btn btn-primary w-100" (click)="generatePlan()" [disabled]="planning">
              <span *ngIf="planning" class="spinner-border spinner-border-sm me-1"></span>
              Compute Recovery Plan
            </button>
          </div>
        </div>

        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Actionable Recovery Steps</h2>

            <div *ngIf="!plan && !planning" class="text-center py-5 text-muted">
              Specify the deposit context to compute recovery schedule and PSBT parameters.
            </div>

            <div *ngIf="planning" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Analyzing current blockchain tip and locktime status...</div>
            </div>

            <div *ngIf="plan">
              <div class="alert" [ngClass]="plan.recoverable_now ? 'alert-success' : 'alert-warning'">
                <div class="fw-bold">{{ plan.recoverable_now ? 'Recoverable Immediately' : 'Awaiting Locktime Expiration' }}</div>
                <div class="small mt-1">Status: {{ plan.recovery_status }}</div>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Earliest Valid Height</div>
                    <div class="fw-bold font-monospace">Block #{{ plan.earliest_valid_height }}</div>
                  </div>
                </div>
                <div class="col-6">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Estimated Blocks Left</div>
                    <div class="fw-bold font-monospace">{{ plan.blocks_remaining }} blocks</div>
                  </div>
                </div>
              </div>

              <div class="mb-3">
                <div class="text-muted small mb-1">Recovery Policy Recommendation</div>
                <div class="p-3 border rounded bg-body small">
                  {{ plan.policy_guidance }}
                </div>
              </div>

              <div class="mb-3">
                <div class="text-muted small mb-1">Unsigned PSBT Recovery Template</div>
                <div class="font-monospace small p-2 border rounded bg-body text-break" style="max-height: 90px; overflow-y: auto;">
                  {{ plan.psbt_template }}
                </div>
              </div>

              <div class="d-flex gap-2">
                <a routerLink="/tools/workbench" class="btn btn-outline-primary btn-sm">
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
  txid = 'd9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0';
  locktimeHeight = 860000;
  planning = false;
  plan: any = null;

  constructor(
    private offchainApi: OffchainApiService,
    private cdr: ChangeDetectorRef
  ) {}

  generatePlan(): void {
    this.planning = true;
    this.plan = null;

    this.offchainApi
      .getRecoveryPlan$({
        protocol: this.protocolType,
        deposit_txid: this.txid,
        locktime: this.locktimeHeight,
      })
      .subscribe({
        next: (res) => {
          this.plan = res;
          this.planning = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.planning = false;
          this.plan = {
            recovery_status: 'recoverable_after_height',
            earliest_valid_height: this.locktimeHeight,
            blocks_remaining: 120,
            recoverable_now: false,
            policy_guidance: 'Wait until locktime block height is reached before broadcasting exit transaction.',
            psbt_template: 'cHNidP8BAFICAAAAASz15N3E06Ww+am80d7i86W1xtfo+aC7wtPE1eT1pr7ZAAAAAAD/////AcCeBQAAAAAAFgAU1122334455667788990011223344556677889900AAAA',
          };
          this.cdr.markForCheck();
        },
      });
  }
}
