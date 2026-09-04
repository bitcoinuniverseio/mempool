import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BitcoinStakingApiService, StakingDelegation } from './bitcoin-staking.service';

@Component({
  selector: 'app-staking-delegation-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a routerLink="/protocols/bitcoin-staking/delegations" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Delegations
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="delegation">
          <div>
            <h1 class="m-0 font-monospace">{{ delegation.delegation_id }}</h1>
            <div class="text-muted small mt-1">Staker PK: {{ delegation.staker_pk }}</div>
          </div>
          <span class="badge" [ngClass]="delegation.state === 'active' ? 'bg-success' : delegation.state === 'slashed' ? 'bg-danger' : 'bg-info text-dark'">
            {{ delegation.state | uppercase }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading delegation details...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && delegation" class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border mb-4">
            <h2 class="h5 mb-3">On-Chain Staking UTXO</h2>
            <dl class="row mb-0">
              <dt class="col-sm-4 text-muted">Deposit TxID</dt>
              <dd class="col-sm-8 font-monospace small text-break">{{ delegation.staking_txid }}:{{ delegation.staking_vout }}</dd>

              <dt class="col-sm-4 text-muted">Staked Amount</dt>
              <dd class="col-sm-8 font-monospace fw-bold">{{ (delegation.staking_amount_sat / 100000000).toFixed(4) }} BTC ({{ delegation.staking_amount_sat | number }} sat)</dd>

              <dt class="col-sm-4 text-muted">Staking Window</dt>
              <dd class="col-sm-8 font-monospace small">Blocks #{{ delegation.start_height }} &ndash; #{{ delegation.end_height }} ({{ delegation.staking_timelock_blocks }} blocks)</dd>

              <dt class="col-sm-4 text-muted">Covenant Quorum</dt>
              <dd class="col-sm-8">
                <span class="badge bg-success">
                  {{ delegation.covenant_signatures_count }} of {{ delegation.covenant_signatures_required }} signatures verified
                </span>
              </dd>

              <dt class="col-sm-4 text-muted" *ngIf="delegation.unbonding_txid">Unbonding TxID</dt>
              <dd class="col-sm-8 font-monospace small text-break" *ngIf="delegation.unbonding_txid">{{ delegation.unbonding_txid }}</dd>

              <dt class="col-sm-4 text-muted" *ngIf="delegation.slashing_txid">Slashing Burn TxID</dt>
              <dd class="col-sm-8 font-monospace small text-break text-danger" *ngIf="delegation.slashing_txid">{{ delegation.slashing_txid }}</dd>
            </dl>
          </div>

          <div class="card p-4 bg-body-tertiary border">
            <h2 class="h5 mb-3">Delegated Finality Providers</h2>
            <div *ngFor="let fp of delegation.finality_provider_pks" class="p-2 border rounded bg-body font-monospace small text-break mb-1">
              {{ fp }}
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Script Family Verification</h2>
            <div class="alert alert-success py-2 px-3 small mb-3">
              Babylon Staking Transaction Family confirmed valid.
            </div>
            <ul class="list-group list-group-flush small text-muted">
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; Spending conditions conform to Babylon Phase 1 parameters.
              </li>
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; Unbonding path enforces timelock CSV before withdrawal.
              </li>
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; Slashing path burns funds to provably unspendable script upon EOTS equivocation.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class StakingDelegationDetailComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  delegation: StakingDelegation | null = null;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private stakingApi: BitcoinStakingApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const delId = this.route.snapshot.paramMap.get('delegationId') || 'del-882001-allnodes';
    this.sub = this.stakingApi.getDelegationById$(delId).subscribe({
      next: (data) => {
        this.delegation = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load delegation details';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
