import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription, combineLatest, forkJoin, of, catchError, map, startWith, switchMap } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { ReservesApiService, ReserveSnapshot } from './reserves.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-reserves-snapshot-detail',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Attestation Snapshot {{ snapshot ? snapshot.snapshot_id : '' }}</h1>
          <span class="badge bg-success" *ngIf="snapshot?.verified_onchain">
            Onchain Verified
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Cryptographic evidence, block context, Merkle root, and UTXO signature validation status for this snapshot.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/intelligence/reserves' | relativeUrl">Overview</a>
          <a class="nav-link active" [routerLink]="'/intelligence/reserves/providers' | relativeUrl">Providers Directory</a>
          <a class="nav-link" [routerLink]="'/intelligence/reserves/verify' | relativeUrl">Verify Proof</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading snapshot attestation details...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && snapshot" class="content-body">
        <div class="card p-4 bg-body-tertiary border mb-4">
          <h2 class="h5 mb-3">Snapshot Metrics</h2><p *ngIf="snapshot.authenticated_root">Provider root signature authenticated. Declared liability: {{ snapshot.attested_liability_sats }} sats. {{ snapshot.evidence_scope }}</p>
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <div class="text-muted small">Provider ID</div>
              <div class="fw-bold">{{ snapshot.provider_id }}</div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-muted small">Block Height & Hash</div>
              <div class="font-monospace small text-truncate">
                {{ snapshot.block_height ?? 'Unknown' }} ({{ snapshot.block_hash ?? 'Unknown' }})
              </div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-muted small">Total Reserves</div>
              <div class="fw-bold text-primary">{{ snapshot.total_reserve_sats == null ? 'Unknown' : (snapshot.total_reserve_sats / 100000000).toFixed(4) + ' BTC' }}</div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-muted small">Total Liabilities</div>
              <div class="fw-bold text-secondary">{{ snapshot.total_liability_sats == null ? 'Unknown' : (snapshot.total_liability_sats / 100000000).toFixed(4) + ' BTC' }}</div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-muted small">Solvency Ratio</div>
              <div class="fw-bold text-success">{{ snapshot.solvency_ratio == null ? 'Not established' : (snapshot.solvency_ratio * 100).toFixed(2) + '%' }}</div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-muted small">UTXO & Signature Count</div>
              <div class="fw-bold">{{ snapshot.utxo_count ?? 'Unknown' }} UTXOs / {{ snapshot.signature_count }} Signatures</div>
            </div>
            <div class="col-12">
              <div class="text-muted small">Committed Liability Root</div>
              <div class="font-monospace small text-break p-2 bg-dark rounded border">
                {{ snapshot.merkle_root }}
              </div>
            </div>
          </div>
        </div>

        <div class="d-flex gap-2">
          <a class="btn btn-outline-secondary" [routerLink]="['/intelligence/reserves/provider' | relativeUrl, snapshot.provider_id]">
            Back to Provider
          </a>
          <a class="btn btn-primary" [routerLink]="'/intelligence/reserves/verify' | relativeUrl">
            Verify Inclusion in this Snapshot
          </a>
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
export class ReservesSnapshotDetailComponent implements OnInit, OnDestroy {
  public snapshot: ReserveSnapshot | null = null;
  public loading = true;
  public error = '';

  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private reservesApi: ReservesApiService,
    private cd: ChangeDetectorRef,
    private state: StateService,
  ) {}

  public ngOnInit(): void {
    this.sub = combineLatest([this.route.paramMap, this.state.networkChanged$.pipe(startWith(this.state.network))]).pipe(
      switchMap(([params]) => {
        this.snapshot = null; this.error = ''; this.loading = true; this.cd.markForCheck();
        const id = params.get('snapshotId');
        if (!id || id.length > 256) { this.error = 'A valid snapshot identity is required.'; return of(null); }
        return this.reservesApi.getSnapshotById(id).pipe(
          map(value => { if (value?.snapshot_id !== id) throw new Error('Mismatched snapshot'); return value; }),
          catchError(() => { this.error = 'Snapshot evidence is unavailable or does not match the requested identity.'; return of(null); }),
        );
      }),
    ).subscribe(value => { this.snapshot = value; this.loading = false; this.cd.markForCheck(); });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
