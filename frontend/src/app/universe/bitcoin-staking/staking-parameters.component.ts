import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BitcoinStakingApiService, StakingProtocolParameters } from './bitcoin-staking.service';

@Component({
  selector: 'app-staking-parameters',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Protocol Parameter Registry</h1>
          <span class="badge bg-secondary" *ngIf="parameters.length > 0">
            {{ parameters.length }} Revisions
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Versioned Babylon staking parameter sets: staking bounds, unbonding timelocks, confirmation depths, and covenant quorum keys.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/protocols/bitcoin-staking">Overview</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/delegations">Delegations</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/finality-providers">Finality Providers</a>
          <a class="nav-link active" routerLink="/protocols/bitcoin-staking/parameters">Parameters</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/evidence">Slashing Evidence</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/reconciliation">PoS Reconciliation</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading parameters...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && parameters.length > 0" class="row g-4">
        <div *ngFor="let p of parameters" class="col-12 col-lg-6">
          <div class="card p-4 h-100 bg-body-tertiary border">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div>
                <h2 class="h5 mt-1 mb-1 font-monospace">{{ p.version_id }}</h2>
                <div class="small text-muted font-monospace">Activation Height: #{{ p.activation_height }}</div>
              </div>
              <span class="badge" [ngClass]="p.is_active ? 'bg-success' : 'bg-secondary'">
                {{ p.is_active ? 'ACTIVE REVISION' : 'PREVIEW' }}
              </span>
            </div>

            <dl class="row mb-0 my-3 small">
              <dt class="col-sm-6 text-muted">Min / Max Staking Time</dt>
              <dd class="col-sm-6 font-monospace">{{ p.min_staking_time_blocks }} &ndash; {{ p.max_staking_time_blocks }} blocks</dd>

              <dt class="col-sm-6 text-muted">Unbonding Delay</dt>
              <dd class="col-sm-6 font-monospace">{{ p.unbonding_time_blocks }} blocks</dd>

              <dt class="col-sm-6 text-muted">Min / Max Stake Satoshis</dt>
              <dd class="col-sm-6 font-monospace">{{ (p.min_staking_amount_sat / 100000000).toFixed(4) }} &ndash; {{ (p.max_staking_amount_sat / 100000000).toFixed(2) }} BTC</dd>

              <dt class="col-sm-6 text-muted">Confirmation Depth</dt>
              <dd class="col-sm-6 font-monospace">{{ p.confirmation_depth }} blocks</dd>

              <dt class="col-sm-6 text-muted">Covenant Committee Quorum</dt>
              <dd class="col-sm-6 font-monospace">{{ p.covenant_quorum.required }} of {{ p.covenant_quorum.total }} keys</dd>
            </dl>

            <div class="mt-auto pt-3 border-top">
              <div class="text-muted small mb-1">Slashing Burn Script (Provably Unspendable)</div>
              <div class="font-monospace small p-2 border rounded bg-body text-break">
                {{ p.slashing_burn_script }}
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
export class StakingParametersComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  parameters: StakingProtocolParameters[] = [];
  private sub?: Subscription;

  constructor(
    private stakingApi: BitcoinStakingApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.stakingApi.getParameters$().subscribe({
      next: (data) => {
        this.parameters = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load parameters';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
