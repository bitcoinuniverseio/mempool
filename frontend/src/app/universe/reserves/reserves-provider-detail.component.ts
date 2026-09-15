import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription, combineLatest, forkJoin, of, catchError, map, startWith, switchMap } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { ReservesApiService, ReserveProvider, ReserveSnapshot } from './reserves.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-reserves-provider-detail',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">{{ provider ? provider.name : 'Provider Detail' }}</h1>
          <span class="badge" *ngIf="provider" [ngClass]="provider.solvency_ratio_percentage == null ? 'bg-secondary' : provider.solvency_ratio_percentage >= 100 ? 'bg-success' : 'bg-danger'">
            {{ provider.solvency_ratio_percentage == null ? 'Not established' : provider.solvency_ratio_percentage + '%' }} Solvency
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Configured provider identity and available signed root evidence for {{ provider?.name || 'this provider' }}.
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
        <div>Loading provider details and historical snapshots...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && provider" class="content-body">
        <!-- Summary Cards -->
        <div class="row g-3 mb-4">
          <div class="col-12 col-md-4">
            <div class="card p-3 bg-body-tertiary border h-100">
              <div class="text-muted small">Total Reserves</div>
              <div class="h4 my-1 text-primary">{{ provider.total_reserve_sats == null ? 'Unknown' : (provider.total_reserve_sats / 100000000).toFixed(2) + ' BTC' }}</div>
              <div class="small text-muted">Verified UTXO evidence required</div>
            </div>
          </div>
          <div class="col-12 col-md-4">
            <div class="card p-3 bg-body-tertiary border h-100">
              <div class="text-muted small">Total Liabilities</div>
              <div class="h4 my-1 text-secondary">{{ provider.total_liability_sats == null ? 'Unknown' : (provider.total_liability_sats / 100000000).toFixed(2) + ' BTC' }}</div>
              <div class="small text-muted">Attested liabilities</div>
            </div>
          </div>
          <div class="col-12 col-md-4">
            <div class="card p-3 bg-body-tertiary border h-100">
              <div class="text-muted small">Proof Standard</div>
              <div class="h4 my-1 text-info text-uppercase">{{ provider.proof_standard }}</div>
              <div class="small text-muted">Frequency: {{ provider.attestation_frequency }}</div>
            </div>
          </div>
        </div>

        <!-- Snapshots List -->
        <section class="card p-4 bg-body-tertiary border">
          <h2 class="h5 mb-3">Published Snapshots</h2>
          <div class="table-responsive" tabindex="0" role="region" aria-label="Published Snapshots, scroll horizontally" i18n-aria-label>
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Snapshot ID</th>
                  <th>Block Height</th>
                  <th>Timestamp</th>
                  <th class="text-end">Reserves</th>
                  <th class="text-end">Liabilities</th>
                  <th class="text-end">Solvency</th>
                  <th class="text-end">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let s of snapshots">
                  <td class="font-monospace fw-semibold">{{ s.snapshot_id }}</td>
                  <td>{{ s.block_height ?? 'Unknown' }}</td>
                  <td class="text-muted small">{{ s.timestamp_utc | date:'medium' }}</td>
                  <td class="text-end">{{ s.total_reserve_sats == null ? 'Unknown' : (s.total_reserve_sats / 100000000).toFixed(2) + ' BTC' }}</td>
                  <td class="text-end">{{ s.total_liability_sats == null ? 'Unknown' : (s.total_liability_sats / 100000000).toFixed(2) + ' BTC' }}</td>
                  <td class="text-end fw-bold text-success">{{ s.solvency_ratio == null ? 'Not established' : (s.solvency_ratio * 100).toFixed(2) + '%' }}</td>
                  <td class="text-end">
                    <a class="btn btn-sm btn-outline-primary" [routerLink]="['/intelligence/reserves/snapshot' | relativeUrl, s.snapshot_id]">
                      Inspect Proof
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .intelligence-page {
      padding: 1.5rem 1rem 3rem;
    }
  `]
})
export class ReservesProviderDetailComponent implements OnInit, OnDestroy {
  public provider: ReserveProvider | null = null;
  public snapshots: ReserveSnapshot[] = [];
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
        this.provider = null; this.snapshots = []; this.error = ''; this.loading = true; this.cd.markForCheck();
        const id = params.get('providerId');
        if (!id || id.length > 256) { this.error = 'A valid provider identity is required.'; return of(null); }
        return forkJoin({ provider: this.reservesApi.getProviderById(id), snapshots: this.reservesApi.getSnapshots(id) }).pipe(
          map(value => {
            if (value.provider?.provider_id !== id || !Array.isArray(value.snapshots) || value.snapshots.some(snapshot => snapshot.provider_id !== id)) throw new Error('Mismatched provider evidence');
            return value;
          }),
          catchError(() => { this.error = 'Provider evidence is unavailable or does not match the requested identity.'; return of(null); }),
        );
      }),
    ).subscribe(value => {
      this.provider = value?.provider ?? null; this.snapshots = value?.snapshots ?? [];
      this.loading = false; this.cd.markForCheck();
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
