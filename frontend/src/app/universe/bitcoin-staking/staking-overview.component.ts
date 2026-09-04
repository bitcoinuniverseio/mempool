import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BitcoinStakingApiService, BitcoinStakingOverview } from './bitcoin-staking.service';

@Component({
  selector: 'app-staking-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Bitcoin Staking & Slashing Evidence Observatory</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            {{ overview.current_protocol_parameter_version }}
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Verifies Babylon-style Bitcoin staking delegations across 18 lifecycle states, finality provider telemetry, Extractable One-Time Signature (EOTS) slashing proofs, and cross-chain PoS reconciliation.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/protocols/bitcoin-staking">Overview</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/delegations">Delegations</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/finality-providers">Finality Providers</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/parameters">Parameters</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/evidence">Slashing Evidence</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/reconciliation">PoS Reconciliation</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Bitcoin staking overview...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Active Staked Bitcoin</div>
            <div class="fs-4 fw-bold mt-1 text-success">{{ (overview.total_staked_sat / 100000000).toFixed(4) }} BTC</div>
            <div class="small text-muted mt-1">{{ overview.total_active_delegations }} active delegations</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Finality Providers</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_finality_providers }}</div>
            <div class="small text-muted mt-1">Staking consensus validators</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Slashed Providers</div>
            <div class="fs-4 fw-bold mt-1" [ngClass]="overview.slashed_providers_count > 0 ? 'text-danger' : 'text-success'">
              {{ overview.slashed_providers_count }}
            </div>
            <div class="small text-muted mt-1">EOTS equivocation proven</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Slashing Proofs</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.recent_slashing_evidences_count }}</div>
            <div class="small text-muted mt-1">Dual-signature evidence records</div>
          </div>
        </div>

        <div class="col-12 col-lg-8">
          <div class="card p-4 bg-body-tertiary border h-100">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h2 class="h5 m-0">Delegation Lifecycle States (18 States Tracked)</h2>
              <a routerLink="/protocols/bitcoin-staking/delegations" class="small text-decoration-none">Inspect Delegations &rarr;</a>
            </div>
            <div class="row g-2">
              <div *ngFor="let state of delegationStates" class="col-6 col-md-4">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small font-monospace">{{ state }}</div>
                  <div class="fs-5 fw-bold font-monospace">{{ overview.delegation_states_summary[state] || 0 }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Cryptographic Architecture</h2>
            <div class="alert alert-info py-2 px-3 small mb-3">
              Self-Custodial Proof-of-Stake Security:
            </div>
            <p class="small text-muted mb-0">
              Bitcoin staking locks BTC in pure Bitcoin script trees (timelock path, unbonding path, and covenant-governed slashing burn path). Stakers never bridge funds to wrapped tokens or third-party custody.
            </p>
            <div class="mt-3">
              <a routerLink="/protocols/bitcoin-staking/evidence" class="btn btn-outline-danger btn-sm w-100">
                Inspect EOTS Slashing Evidence &rarr;
              </a>
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
export class StakingOverviewComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  overview: BitcoinStakingOverview | null = null;
  delegationStates = [
    'active',
    'unbonding_requested',
    'unbonding_active',
    'unbonded',
    'withdrawn',
    'expired',
    'slashed_pending',
    'slashed',
    'overflow_rejected',
    'under_min_stake',
    'over_max_stake',
    'invalid_script',
    'invalid_covenant_sigs',
    'reorg_rolled_back',
    'conflicting_eots',
    'unknown_orphan',
    'registered',
    'submitted',
  ];
  private sub?: Subscription;

  constructor(
    private stakingApi: BitcoinStakingApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.stakingApi.getOverview$().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load staking overview';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
