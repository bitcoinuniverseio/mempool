import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BitcoinStakingApiService, FinalityProvider } from './bitcoin-staking.service';

@Component({
  selector: 'app-staking-finality-providers',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Finality Providers Directory</h1>
          <span class="badge bg-secondary" *ngIf="providers.length > 0">
            {{ providers.length }} Providers
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Registered Babylon finality providers, active Bitcoin TVL, commission rates, uptime performance, and EOTS public keys.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/protocols/bitcoin-staking">Overview</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/delegations">Delegations</a>
          <a class="nav-link active" routerLink="/protocols/bitcoin-staking/finality-providers">Finality Providers</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/parameters">Parameters</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/evidence">Slashing Evidence</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/reconciliation">PoS Reconciliation</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading finality providers...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && providers.length > 0" class="row g-4">
        <div *ngFor="let p of providers" class="col-12 col-lg-6">
          <div class="card p-4 h-100 bg-body-tertiary border">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div>
                <h2 class="h5 mt-1 mb-1">{{ p.moniker }}</h2>
                <div class="small font-monospace text-muted text-break">{{ p.btc_pk }}</div>
              </div>
              <span class="badge" [ngClass]="p.is_slashed ? 'bg-danger' : 'bg-success'">
                {{ p.is_slashed ? 'SLASHED' : 'ACTIVE' }}
              </span>
            </div>

            <div class="row g-2 my-3">
              <div class="col-4">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Active TVL</div>
                  <div class="fw-bold font-monospace">{{ (p.active_tvl_sat / 100000000).toFixed(2) }} BTC</div>
                </div>
              </div>
              <div class="col-4">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Commission</div>
                  <div class="fw-bold">{{ p.commission_rate_percent }}%</div>
                </div>
              </div>
              <div class="col-4">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Uptime</div>
                  <div class="fw-bold">{{ p.uptime_percent }}%</div>
                </div>
              </div>
            </div>

            <div class="mt-auto pt-3 border-top d-flex justify-content-between align-items-center">
              <span class="small text-muted">{{ p.delegations_count }} delegations</span>
              <a [routerLink]="['/protocols/bitcoin-staking/finality-provider', p.provider_id]" class="btn btn-sm btn-outline-primary">
                Provider Details
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
export class StakingFinalityProvidersComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  providers: FinalityProvider[] = [];
  private sub?: Subscription;

  constructor(
    private stakingApi: BitcoinStakingApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.stakingApi.getFinalityProviders$().subscribe({
      next: (data) => {
        this.providers = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load finality providers';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
