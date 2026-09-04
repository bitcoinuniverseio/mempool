import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { OffchainApiService, OffchainOperator } from './offchain.service';

@Component({
  selector: 'app-statechain-operator-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a routerLink="/offchain/statechains/operators" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Operators
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="operator">
          <div>
            <h1 class="m-0">{{ operator.display_name }}</h1>
            <div class="text-muted small font-monospace mt-1 text-break">{{ operator.operator_public_key }}</div>
          </div>
          <span class="badge" [ngClass]="operator.health === 'healthy' ? 'bg-success' : 'bg-warning text-dark'">
            {{ operator.health | uppercase }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading operator details...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && operator" class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border mb-4">
            <h2 class="h5 mb-3">Operator Endpoints & Connectivity</h2>
            <dl class="row mb-0">
              <dt class="col-sm-4 text-muted">Operator Key</dt>
              <dd class="col-sm-8 font-monospace small text-break">{{ operator.operator_public_key }}</dd>

              <dt class="col-sm-4 text-muted">Clearnet Endpoint</dt>
              <dd class="col-sm-8 font-monospace small text-break">{{ operator.endpoint }}</dd>

              <dt class="col-sm-4 text-muted" *ngIf="operator.tor_endpoint">Onion Service</dt>
              <dd class="col-sm-8 font-monospace small text-break" *ngIf="operator.tor_endpoint">{{ operator.tor_endpoint }}</dd>

              <dt class="col-sm-4 text-muted">Protocol</dt>
              <dd class="col-sm-8"><span class="badge bg-secondary">{{ operator.protocol }}</span></dd>

              <dt class="col-sm-4 text-muted">Supported Versions</dt>
              <dd class="col-sm-8 font-monospace small">{{ operator.supported_versions.join(', ') }}</dd>

              <dt class="col-sm-4 text-muted">Last Successful Probe</dt>
              <dd class="col-sm-8 small">{{ operator.last_probe_at }}</dd>
            </dl>
          </div>

          <div class="card p-4 bg-body-tertiary border">
            <h2 class="h5 mb-3">Trust Model & Verifiable Guarantees</h2>
            <div class="alert alert-info py-2 px-3 small mb-2">
              Blinded Statechain Security Notice:
            </div>
            <p class="small text-muted mb-0">
              The operator cannot spend UTXOs unilaterally because each statechain deposit uses a 2-of-2 multisig or MuSig2 key shared with the current owner. However, receiving clients must verify the decrementing timelock sequence across every prior backup transaction to protect against operator counterparty collusion.
            </p>
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Published Terms</h2>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Service Fee</div>
              <div class="fs-4 fw-bold">{{ operator.published_terms.fee_rate_basis_points / 100 }}%</div>
              <div class="small text-muted mt-1">{{ operator.published_terms.fee_rate_basis_points }} basis points per transfer</div>
            </div>

            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Minimum Deposit</div>
              <div class="fs-5 fw-bold">{{ operator.published_terms.min_amount_sat | number }} sat</div>
            </div>

            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Maximum Deposit</div>
              <div class="fs-5 fw-bold">{{ operator.published_terms.max_amount_sat | number }} sat</div>
            </div>

            <div class="mt-auto pt-3 border-top">
              <a [routerLink]="['/offchain/statechains/verify']" class="btn btn-outline-primary w-100">
                Verify Transfer Package with this Operator
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class StatechainOperatorDetailComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  operator: OffchainOperator | null = null;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private offchainApi: OffchainApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const operatorId = this.route.snapshot.paramMap.get('operatorId') || 'sc-mercury-alpha';
    this.sub = this.offchainApi.getOperatorById$(operatorId).subscribe({
      next: (data) => {
        this.operator = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load operator detail';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
