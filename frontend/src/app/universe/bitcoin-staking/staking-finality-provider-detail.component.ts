import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BitcoinStakingApiService, FinalityProvider } from './bitcoin-staking.service';

@Component({
  selector: 'app-staking-finality-provider-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a routerLink="/protocols/bitcoin-staking/finality-providers" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Finality Providers
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="provider">
          <div>
            <h1 class="m-0">{{ provider.moniker }}</h1>
            <div class="text-muted small font-monospace mt-1 text-break">BTC PK: {{ provider.btc_pk }}</div>
          </div>
          <span class="badge" [ngClass]="provider.is_slashed ? 'bg-danger' : 'bg-success'">
            {{ provider.is_slashed ? 'SLASHED' : 'HEALTHY' }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading provider details...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && provider" class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border mb-4">
            <h2 class="h5 mb-3">Identity & Keys</h2>
            <dl class="row mb-0">
              <dt class="col-sm-4 text-muted">Bitcoin Public Key</dt>
              <dd class="col-sm-8 font-monospace small text-break">{{ provider.btc_pk }}</dd>

              <dt class="col-sm-4 text-muted">EOTS Public Key</dt>
              <dd class="col-sm-8 font-monospace small text-break">{{ provider.eots_public_key }}</dd>

              <dt class="col-sm-4 text-muted">First Registered</dt>
              <dd class="col-sm-8 small">{{ provider.first_registered_at }}</dd>

              <dt class="col-sm-4 text-muted">Last Activity</dt>
              <dd class="col-sm-8 small">{{ provider.last_activity_at }}</dd>
            </dl>
          </div>

          <div class="card p-4 bg-body-tertiary border">
            <h2 class="h5 mb-3">EOTS Slashing State</h2>
            <div class="alert" [ngClass]="provider.is_slashed ? 'alert-danger' : 'alert-success'">
              <div class="fw-bold" *ngIf="provider.is_slashed">Equivocation Proven & Slashed</div>
              <div class="fw-bold" *ngIf="!provider.is_slashed">No Equivocation Detected</div>
              <p class="small m-0 mt-1">
                Finality providers sign PoS block finality using Extractable One-Time Signatures. Signing conflicting blocks at the same height allows anyone to extract the private key and broadcast a slashing burn transaction.
              </p>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Performance & Stake</h2>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Active Staked TVL</div>
              <div class="fs-4 fw-bold font-monospace">{{ (provider.active_tvl_sat / 100000000).toFixed(4) }} BTC</div>
            </div>

            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Commission Rate</div>
              <div class="fs-5 fw-bold">{{ provider.commission_rate_percent }}%</div>
            </div>

            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Uptime Reliability</div>
              <div class="fs-5 fw-bold font-monospace">{{ provider.uptime_percent }}%</div>
            </div>

            <div class="mt-auto pt-3 border-top">
              <a [routerLink]="['/protocols/bitcoin-staking/delegations']" class="btn btn-outline-primary w-100">
                View Active Delegations
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class StakingFinalityProviderDetailComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  provider: FinalityProvider | null = null;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private stakingApi: BitcoinStakingApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const providerId = this.route.snapshot.paramMap.get('providerId') || 'fp-allnodes-01';
    this.sub = this.stakingApi.getFinalityProviderById$(providerId).subscribe({
      next: (data) => {
        this.provider = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load provider details';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
