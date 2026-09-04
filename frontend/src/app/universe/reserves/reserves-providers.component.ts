import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { ReservesApiService, ReserveProvider } from './reserves.service';

@Component({
  selector: 'app-reserves-providers',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Reserve Providers Directory</h1>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Participating exchanges, custody networks, and federated bridges publishing verified cryptographic proof of reserves.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/intelligence/reserves">Overview</a>
          <a class="nav-link active" routerLink="/intelligence/reserves/providers">Providers Directory</a>
          <a class="nav-link" routerLink="/intelligence/reserves/verify">Verify Proof</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading reserve providers...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && providers.length > 0" class="content-body">
        <div class="row g-4">
          <div class="col-12 col-md-6 col-lg-4" *ngFor="let p of providers">
            <div class="card p-4 bg-body-tertiary border h-100 d-flex flex-column">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <span class="badge bg-secondary text-capitalize">{{ p.category.replace('_', ' ') }}</span>
                <span class="badge" [ngClass]="p.status === 'active' ? 'bg-success' : 'bg-warning text-dark'">
                  {{ p.status }}
                </span>
              </div>
              <h2 class="h5 mb-1">{{ p.name }}</h2>
              <div class="text-muted small mb-3">Standard: <strong class="text-uppercase">{{ p.proof_standard }}</strong></div>

              <div class="mt-auto">
                <div class="d-flex justify-content-between py-1 border-bottom">
                  <span class="text-muted small">Reserve:</span>
                  <span class="fw-semibold">{{ (p.total_reserve_sats / 100000000).toFixed(2) | number }} BTC</span>
                </div>
                <div class="d-flex justify-content-between py-1 border-bottom">
                  <span class="text-muted small">Liability:</span>
                  <span class="fw-semibold">{{ (p.total_liability_sats / 100000000).toFixed(2) | number }} BTC</span>
                </div>
                <div class="d-flex justify-content-between py-1 border-bottom">
                  <span class="text-muted small">Solvency:</span>
                  <span class="fw-bold" [ngClass]="p.solvency_ratio_percentage >= 100 ? 'text-success' : 'text-danger'">
                    {{ p.solvency_ratio_percentage }}%
                  </span>
                </div>
                <div class="d-flex justify-content-between py-1 mb-3">
                  <span class="text-muted small">Frequency:</span>
                  <span class="text-capitalize">{{ p.attestation_frequency }}</span>
                </div>

                <a class="btn btn-primary w-100" [routerLink]="['/intelligence/reserves/provider', p.provider_id]">
                  View Attestation History
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .intelligence-page {
      padding: 1.5rem 1rem 3rem;
    }
  `]
})
export class ReservesProvidersComponent implements OnInit, OnDestroy {
  public providers: ReserveProvider[] = [];
  public loading = true;
  public error = '';

  private sub?: Subscription;

  constructor(
    private reservesApi: ReservesApiService,
    private cd: ChangeDetectorRef,
  ) {}

  public ngOnInit(): void {
    this.sub = this.reservesApi.getProviders().subscribe({
      next: (data) => {
        this.providers = data;
        this.loading = false;
        this.cd.markForCheck();
      },
      error: (err) => {
        this.error = err?.message || 'Failed to load reserve providers';
        this.loading = false;
        this.cd.markForCheck();
      },
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
