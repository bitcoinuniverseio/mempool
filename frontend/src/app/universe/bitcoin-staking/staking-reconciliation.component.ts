import { observeStaking, slashingLabel, reconciliationLabel } from './staking-view';
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { BitcoinStakingApiService } from './bitcoin-staking.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-staking-reconciliation',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Cross-Chain PoS Reconciliation Engine</h1>
          <span class="badge bg-secondary" *ngIf="result">Source report</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Reconciles Bitcoin Layer 1 timelocked UTXOs with Babylon consumer Proof-of-Stake voting power and unbonding state machines.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/protocols/bitcoin-staking' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/protocols/bitcoin-staking/delegations' | relativeUrl">Delegations</a>
          <a class="nav-link" [routerLink]="'/protocols/bitcoin-staking/finality-providers' | relativeUrl">Finality Providers</a>
          <a class="nav-link" [routerLink]="'/protocols/bitcoin-staking/parameters' | relativeUrl">Parameters</a>
          <a class="nav-link" [routerLink]="'/protocols/bitcoin-staking/evidence' | relativeUrl">Slashing Evidence</a>
          <a class="nav-link active" [routerLink]="'/protocols/bitcoin-staking/reconciliation' | relativeUrl">PoS Reconciliation</a>
        </nav>
      </header>

      <div *ngIf="error" class="alert alert-warning" role="alert">
        {{ error }}
      </div>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Reconciling Bitcoin UTXO sets with PoS consensus state...</div>
      </div>

      <div *ngIf="!loading && result" class="row g-4">
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Consumer PoS Chain</div>
            <div class="fs-4 fw-bold mt-1 font-monospace">{{ result.chain_name }}</div>
            <div class="small text-muted mt-1">Height #{{ result.consumer_app_height }}</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Bitcoin Layer 1 Tip</div>
            <div class="fs-4 fw-bold mt-1 font-monospace">#{{ result.btc_tip_height }}</div>
            <div class="small text-success mt-1">Reported height; confirmations not checked here</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Active Stake Parity</div>
            <div class="fs-4 fw-bold text-success mt-1">{{ reconciliationLabel(result) }}</div>
            <div class="small text-muted mt-1">Balance equality does not establish state synchronization.</div>
          </div>
        </div>

        <div class="col-12 col-lg-8">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Stake Balance Reconciliation</h2>
            <div class="row g-3 mb-3">
              <div class="col-6">
                <div class="p-3 border rounded bg-body">
                  <div class="text-muted small">On-Chain Bitcoin UTXOs</div>
                  <div class="fs-4 fw-bold font-monospace">{{ result.total_btc_stake_sat ?? 'Unknown' }} sats</div>
                </div>
              </div>
              <div class="col-6">
                <div class="p-3 border rounded bg-body">
                  <div class="text-muted small">Consumer PoS Voting Power</div>
                  <div class="fs-4 fw-bold font-monospace">{{ result.total_consumer_voting_power_sat ?? 'Unknown' }} sats</div>
                </div>
              </div>
            </div>

            <div class="p-3 border rounded bg-body">
              <div class="d-flex justify-content-between">
                <span class="fw-bold">Unbonding State Synchronization</span>
                <span class="badge bg-success font-monospace">{{ result.unbonding_sync_status | uppercase }}</span>
              </div>
              <p class="small text-muted mb-0 mt-1">
                The reported status requires independent chain and schedule checks.
              </p>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Discrepancy Audit Log</h2>
            <div class="alert alert-success py-2 px-3 small mb-2">
              Discrepancy absence is not established by this response.
            </div>
            <p class="small text-muted mb-0">
              This panel displays one source response. It does not continuously verify stake UTXOs or consumer validators.
            </p>
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
export class StakingReconciliationComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  result: any = null;
  private sub?: Subscription;

  constructor(
    private stakingApi: BitcoinStakingApiService,
    private cdr: ChangeDetectorRef
  ) {}

  readonly slashingLabel = slashingLabel;
  readonly reconciliationLabel = reconciliationLabel;
  ngOnInit(): void {
    this.sub = observeStaking(this.stakingApi.networkChanges$, () => {this.result = null;this.loading=true;this.error=null;this.cdr.markForCheck();},
      () => this.stakingApi.reconcile$('babylon-pos-hub-1'), data => {this.result=data;this.loading=false;this.cdr.markForCheck();},
      err => {this.result=null;this.error=err?.error?.error || err?.message || loadFailureMessage(classifyLoadFailure(err));this.loading=false;this.cdr.markForCheck();});
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
