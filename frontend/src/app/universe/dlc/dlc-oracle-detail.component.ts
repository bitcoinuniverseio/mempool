import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { DlcApiService, DlcOracle } from './dlc.service';

@Component({
  selector: 'app-dlc-oracle-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a routerLink="/contracts/dlc/oracles" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Oracles
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="oracle">
          <div>
            <h1 class="m-0">{{ oracle.display_name }}</h1>
            <div class="text-muted small font-monospace mt-1 text-break">{{ oracle.oracle_public_key }}</div>
          </div>
          <span class="badge" [ngClass]="oracle.health === 'healthy' ? 'bg-success' : 'bg-warning text-dark'">
            {{ oracle.health | uppercase }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading oracle details...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && oracle" class="row g-4">
        <div class="col-12 col-lg-8">
          <div class="card p-4 bg-body-tertiary border mb-4">
            <h2 class="h5 mb-3">Cryptographic Identity & Endpoint</h2>
            <dl class="row mb-0">
              <dt class="col-sm-4 text-muted">Public Key (x-only)</dt>
              <dd class="col-sm-8 font-monospace small text-break">{{ oracle.oracle_public_key }}</dd>

              <dt class="col-sm-4 text-muted">Endpoint URL</dt>
              <dd class="col-sm-8 font-monospace small text-break">{{ oracle.endpoint }}</dd>

              <dt class="col-sm-4 text-muted">Endpoint Type</dt>
              <dd class="col-sm-8"><span class="badge bg-info text-dark">{{ oracle.endpoint_type }}</span></dd>

              <dt class="col-sm-4 text-muted">Protocol Revision</dt>
              <dd class="col-sm-8 font-monospace small">{{ oracle.protocol_revision }}</dd>

              <dt class="col-sm-4 text-muted">Registration Source</dt>
              <dd class="col-sm-8 small">{{ oracle.registration_source }}</dd>

              <dt class="col-sm-4 text-muted">First Observed</dt>
              <dd class="col-sm-8 small">{{ oracle.first_observed_at }}</dd>

              <dt class="col-sm-4 text-muted">Last Success</dt>
              <dd class="col-sm-8 small">{{ oracle.last_success_at }}</dd>
            </dl>
          </div>

          <div class="card p-4 bg-body-tertiary border">
            <h2 class="h5 mb-3">Verification & Equivocation Status</h2>
            <div class="alert" [ngClass]="oracle.coverage.conflicts_detected === 0 ? 'alert-success' : 'alert-danger'">
              <div class="fw-bold" *ngIf="oracle.coverage.conflicts_detected === 0">No Nonce Reuse or Equivocation Detected</div>
              <div class="fw-bold" *ngIf="oracle.coverage.conflicts_detected > 0">Equivocation Conflict Recorded</div>
              <p class="small m-0 mt-1">
                Every announcement and attestation signed by this oracle public key is evaluated for repeated nonces across divergent messages.
              </p>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Attestation Statistics</h2>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Total Announcements</div>
              <div class="fs-4 fw-bold">{{ oracle.coverage.total_announcements }}</div>
            </div>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Total Attestations</div>
              <div class="fs-4 fw-bold">{{ oracle.coverage.total_attestations }}</div>
            </div>
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Observed Conflicts</div>
              <div class="fs-4 fw-bold" [ngClass]="oracle.coverage.conflicts_detected > 0 ? 'text-danger' : 'text-success'">
                {{ oracle.coverage.conflicts_detected }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class DlcOracleDetailComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  oracle: DlcOracle | null = null;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private dlcApi: DlcApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const oracleId = this.route.snapshot.paramMap.get('oracleId') || 'oracle-kormir-rates';
    this.sub = this.dlcApi.getOracleById$(oracleId).subscribe({
      next: (data) => {
        this.oracle = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load oracle detail';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
