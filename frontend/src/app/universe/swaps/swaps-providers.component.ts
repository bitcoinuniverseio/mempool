import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SwapsApiService, SwapProvider } from './swaps.service';

@Component({
  selector: 'app-swaps-providers',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Swap Provider Directory</h1>
        <p class="text-muted">Registered liquidity providers with verifiable cryptographic capability manifests.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/swaps">Overview</a>
          <a class="nav-link" routerLink="/swaps/submarine">Submarine</a>
          <a class="nav-link" routerLink="/swaps/reverse">Reverse</a>
          <a class="nav-link" routerLink="/swaps/chain">Chain Swaps</a>
          <a class="nav-link active" routerLink="/swaps/providers">Providers</a>
          <a class="nav-link" routerLink="/swaps/inspect">Inspector</a>
          <a class="nav-link" routerLink="/swaps/recover">Recovery Planner</a>
          <a class="nav-link" routerLink="/swaps/simulate">Simulator</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading providers...</div>
      </div>

      <div *ngIf="!loading && providers" class="row g-4">
        <div class="col-12 col-md-6" *ngFor="let p of providers">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h5 class="m-0">{{ p.name }}</h5>
              <span class="badge bg-success">{{ p.health_status | uppercase }}</span>
            </div>
            <p class="small text-muted font-monospace mb-2">{{ p.identity_key }}</p>
            <div class="row g-2 mb-3 small">
              <div class="col-6"><strong>Fee:</strong> {{ p.fee_percentage }}%</div>
              <div class="col-6"><strong>Miner Est:</strong> {{ p.miner_fee_estimate_sats }} sats</div>
              <div class="col-6"><strong>Min:</strong> {{ p.minimum_amount_sats | number }} sats</div>
              <div class="col-6"><strong>Max:</strong> {{ p.maximum_amount_sats | number }} sats</div>
              <div class="col-12">
                <strong>Supported:</strong>
                <span class="badge bg-dark ms-1" *ngFor="let t of p.swap_types">{{ t }}</span>
              </div>
            </div>
            <a class="btn btn-outline-primary btn-sm mt-auto" [routerLink]="['/swaps/provider', p.provider_id]">
              View Verification History & Manifest
            </a>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SwapsProvidersComponent implements OnInit, OnDestroy {
  public providers: SwapProvider[] = [];
  public loading = true;
  private sub?: Subscription;

  constructor(private api: SwapsApiService, private cdr: ChangeDetectorRef) {}

  public ngOnInit(): void {
    this.sub = this.api.getProviders$().subscribe({
      next: (data) => {
        this.providers = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
