import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { OffchainApiService, OffchainOperator } from './offchain.service';

@Component({
  selector: 'app-statechain-operators',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Statechain Operators Directory</h1>
          <span class="badge bg-secondary" *ngIf="operators.length > 0">
            {{ operators.length }} Operators
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Signed operator manifests, endpoint telemetry, supported protocol revisions, and signature counters for blinded statechains.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/offchain/utxo">Overview</a>
          <a class="nav-link active" routerLink="/offchain/statechains/operators">Statechains</a>
          <a class="nav-link" routerLink="/offchain/statechains/verify">Transfer Verifier</a>
          <a class="nav-link" routerLink="/offchain/coinswap">CoinSwap</a>
          <a class="nav-link" routerLink="/offchain/coinswap/inspect">CoinSwap Inspector</a>
          <a class="nav-link" routerLink="/offchain/recovery">Recovery Planner</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading statechain operators...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && operators.length > 0" class="row g-4">
        <div *ngFor="let op of operators" class="col-12 col-lg-6">
          <div class="card p-4 h-100 bg-body-tertiary border">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div>
                <span class="badge bg-primary me-1">{{ op.protocol }}</span>
                <span class="badge bg-info text-dark" *ngIf="op.is_tor_only">TOR ONLY</span>
                <h2 class="h5 mt-2 mb-1">{{ op.display_name }}</h2>
                <div class="small font-monospace text-muted text-break">{{ op.operator_public_key }}</div>
              </div>
              <span class="badge" [ngClass]="op.health === 'healthy' ? 'bg-success' : 'bg-warning text-dark'">
                {{ op.health | uppercase }}
              </span>
            </div>

            <div class="row g-2 my-3">
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Fee Rate</div>
                  <div class="fw-bold">{{ op.published_terms.fee_rate_basis_points / 100 }}%</div>
                </div>
              </div>
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Amount Limits</div>
                  <div class="fw-bold font-monospace small">
                    {{ op.published_terms.min_amount_sat | number }} &ndash; {{ op.published_terms.max_amount_sat | number }} sat
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-auto pt-3 border-top d-flex justify-content-between align-items-center">
              <span class="small text-muted font-monospace text-break">{{ op.endpoint }}</span>
              <a [routerLink]="['/offchain/statechains/operator', op.operator_id]" class="btn btn-sm btn-outline-primary">
                Operator Details
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
export class StatechainOperatorsComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  operators: OffchainOperator[] = [];
  private sub?: Subscription;

  constructor(
    private offchainApi: OffchainApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.offchainApi.getOperators$('mercury_statechain').subscribe({
      next: (data) => {
        this.operators = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load statechain operators';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
