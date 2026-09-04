import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { EcashApiService, EcashOverview } from './ecash.service';

@Component({
  selector: 'app-ecash-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Ecash and Federation Observatory</h1>
          <span class="badge bg-primary" *ngIf="overview">
            Chaumian Ecash & Fedimint Consensus
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Public telemetry, keyset lifecycles, and guardian federation tracking for privacy-preserving Bitcoin ecash protocols.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/ecash">Overview</a>
          <a class="nav-link" routerLink="/ecash/cashu">Cashu Mints</a>
          <a class="nav-link" routerLink="/ecash/fedimint">Fedimint Federations</a>
          <a class="nav-link" routerLink="/ecash/inspect">Offline Token Inspector</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading ecash and federation telemetry...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="content-body">
        <!-- Top Metrics Cards -->
        <section class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Monitored Cashu Mints</div>
              <div class="h4 my-1 text-primary">{{ overview.total_cashu_mints }}</div>
              <div class="small text-muted">Active NUT specification support</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Fedimint Federations</div>
              <div class="h4 my-1 text-success">{{ overview.total_fedimint_federations }}</div>
              <div class="small text-muted">Multi-guardian community mints</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Verified Guardians</div>
              <div class="h4 my-1 text-info">{{ overview.total_verified_guardians }}</div>
              <div class="small text-muted">Distributed quorum participants</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Signed Operator Claims</div>
              <div class="h4 my-1 text-warning">{{ overview.active_claims_count }}</div>
              <div class="small text-muted">Cryptographically attested</div>
            </div>
          </div>
        </section>

        <!-- Cashu Mints Preview -->
        <section class="card p-4 bg-body-tertiary border mb-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h2 class="h5 m-0">Cashu Mints</h2>
            <a routerLink="/ecash/cashu" class="btn btn-sm btn-outline-primary">View All Mints</a>
          </div>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Mint Name</th>
                  <th>Endpoint URL</th>
                  <th>NUTs Supported</th>
                  <th>Keysets</th>
                  <th class="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let m of overview.mints">
                  <td class="fw-bold">{{ m.name }}</td>
                  <td><code>{{ m.mint_url }}</code></td>
                  <td>
                    <span class="badge bg-secondary me-1">NUT-00..{{ m.nuts_supported[m.nuts_supported.length - 1] }}</span>
                  </td>
                  <td>{{ m.active_keysets_count }} active</td>
                  <td class="text-end">
                    <a [routerLink]="['/ecash/cashu', m.mint_id]" class="btn btn-sm btn-outline-primary">
                      Inspect
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Fedimint Federations Preview -->
        <section class="card p-4 bg-body-tertiary border mb-4">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h2 class="h5 m-0">Fedimint Federations</h2>
            <a routerLink="/ecash/fedimint" class="btn btn-sm btn-outline-primary">View All Federations</a>
          </div>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Federation Name</th>
                  <th>Quorum Threshold</th>
                  <th>Enabled Modules</th>
                  <th>Current Epoch</th>
                  <th class="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let f of overview.federations">
                  <td class="fw-bold">{{ f.name }}</td>
                  <td><span class="badge bg-info">{{ f.threshold }}-of-{{ f.guardians_count }} Quorum</span></td>
                  <td>
                    <span *ngFor="let mod of f.modules" class="badge bg-secondary me-1">{{ mod }}</span>
                  </td>
                  <td>Epoch {{ f.current_epoch | number }}</td>
                  <td class="text-end">
                    <a [routerLink]="['/ecash/fedimint', f.federation_id]" class="btn btn-sm btn-outline-primary">
                      Inspect
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
    .nav-link {
      color: inherit;
      padding: 0.4rem 0.8rem;
      border-radius: 0.375rem;
    }
    .nav-link.active {
      background-color: var(--bs-primary, #f7931a);
      color: #fff;
    }
  `],
})
export class EcashOverviewComponent implements OnInit, OnDestroy {
  overview: EcashOverview | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: EcashApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getOverview$().subscribe({
        next: data => {
          this.overview = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load ecash overview';
          this.loading = false;
          this.cd.markForCheck();
        },
      })
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
