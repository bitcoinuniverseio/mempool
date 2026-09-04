import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BitcoinStakingApiService, StakingDelegation } from './bitcoin-staking.service';

@Component({
  selector: 'app-staking-delegations',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Staking Delegations</h1>
          <span class="badge bg-secondary" *ngIf="delegations.length > 0">
            {{ delegations.length }} Delegations
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Verifiable on-chain staking delegations, timelock windows, covenant quorum threshold signatures, and unbonding progress.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/protocols/bitcoin-staking">Overview</a>
          <a class="nav-link active" routerLink="/protocols/bitcoin-staking/delegations">Delegations</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/finality-providers">Finality Providers</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/parameters">Parameters</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/evidence">Slashing Evidence</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/reconciliation">PoS Reconciliation</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading delegations...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && delegations.length > 0" class="card p-4 bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Delegation ID</th>
                <th>Amount</th>
                <th>Timelock</th>
                <th>Covenant Sigs</th>
                <th>State</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let d of delegations">
                <td class="font-monospace fw-bold">{{ d.delegation_id }}</td>
                <td class="font-monospace">{{ (d.staking_amount_sat / 100000000).toFixed(4) }} BTC</td>
                <td class="font-monospace small">{{ d.staking_timelock_blocks }} blocks</td>
                <td>
                  <span class="badge" [ngClass]="d.covenant_signatures_count >= d.covenant_signatures_required ? 'bg-success' : 'bg-warning text-dark'">
                    {{ d.covenant_signatures_count }} / {{ d.covenant_signatures_required }}
                  </span>
                </td>
                <td>
                  <span class="badge" [ngClass]="getStateBadgeClass(d.state)">
                    {{ d.state | uppercase }}
                  </span>
                </td>
                <td>
                  <a [routerLink]="['/protocols/bitcoin-staking/delegation', d.delegation_id]" class="btn btn-sm btn-outline-primary">
                    Inspect
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class StakingDelegationsComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  delegations: StakingDelegation[] = [];
  private sub?: Subscription;

  constructor(
    private stakingApi: BitcoinStakingApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.stakingApi.getDelegations$().subscribe({
      next: (data) => {
        this.delegations = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load delegations';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  getStateBadgeClass(state: string): string {
    switch (state) {
      case 'active':
        return 'bg-success';
      case 'unbonding_active':
      case 'unbonding_requested':
        return 'bg-info text-dark';
      case 'slashed':
      case 'slashed_pending':
      case 'conflicting_eots':
        return 'bg-danger';
      case 'withdrawn':
      case 'unbonded':
        return 'bg-secondary';
      default:
        return 'bg-warning text-dark';
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
