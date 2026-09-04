import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SimplicityApiService, SimplicityOverview } from './simplicity.service';

@Component({
  selector: 'app-simplicity-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Simplicity Smart Contract Explorer</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            {{ overview.total_programs }} Programs Registered
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Typed functional smart-contract language for Liquid Network with static resource bounds and formal verification.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/liquid/simplicity">Overview</a>
          <a class="nav-link" routerLink="/liquid/simplicity/contracts">Contract Programs</a>
          <a class="nav-link" routerLink="/tools/simplicity">Compiler Workbench</a>
          <a class="nav-link" routerLink="/tools/simplicity/verify">Formal Proof Verifier</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Simplicity contract overview...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Registered Programs</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_programs }}</div>
            <div class="small text-muted mt-1">Unique Commitment Merkle Roots</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">On-Chain Occurrences</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_occurrences }}</div>
            <div class="small text-muted mt-1">Liquid network spend witnesses</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Formally Verified</div>
            <div class="fs-4 fw-bold text-success mt-1">{{ overview.formally_verified_count }}</div>
            <div class="small text-muted mt-1">Machine-checked Coq/Lean proofs</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Recognized Jets</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.jets_catalog_size }}</div>
            <div class="small text-muted mt-1">Optimized C consensus primitives</div>
          </div>
        </div>

        <div class="col-12 col-lg-8">
          <div class="card p-4 bg-body-tertiary border h-100">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h2 class="h5 m-0">Featured Simplicity Contracts</h2>
              <a routerLink="/liquid/simplicity/contracts" class="small text-decoration-none">View All &rarr;</a>
            </div>
            <div class="table-responsive">
              <table class="table table-sm table-hover align-middle">
                <thead>
                  <tr>
                    <th>Program</th>
                    <th>Type</th>
                    <th>Jets</th>
                    <th>Cost</th>
                    <th>Verified</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let p of overview.featured_programs">
                    <td>
                      <a [routerLink]="['/liquid/simplicity/program', p.program_id]" class="fw-bold text-decoration-none">
                        {{ p.source_name || p.program_id }}
                      </a>
                      <div class="font-monospace text-muted small text-truncate" style="max-width: 220px;">
                        CMR: {{ p.cmr }}
                      </div>
                    </td>
                    <td><span class="badge bg-secondary">{{ p.program_type }}</span></td>
                    <td>
                      <span *ngFor="let jet of p.jets_used" class="badge bg-body border text-body me-1 small">
                        {{ jet }}
                      </span>
                    </td>
                    <td class="font-monospace small">{{ p.static_cost_weight }} WU</td>
                    <td>
                      <span class="badge" [ngClass]="p.is_formally_verified ? 'bg-success' : 'bg-secondary'">
                        {{ p.is_formally_verified ? 'VERIFIED' : 'UNPROVEN' }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Toolchain Revisions</h2>
            <div *ngFor="let tc of overview.supported_toolchains" class="p-3 border rounded bg-body mb-2">
              <div class="d-flex justify-content-between align-items-center">
                <div class="fw-bold">{{ tc.version }}</div>
                <span class="badge bg-info text-dark">{{ tc.status }}</span>
              </div>
              <div class="text-muted small font-monospace mt-1">libSimplicity: {{ tc.libsimplicity_commit }}</div>
              <div class="text-muted small font-monospace">SimplicityHL: {{ tc.simplicityhl_version }}</div>
            </div>
            <div class="alert alert-info py-2 px-3 small m-0 mt-3">
              Consensus validation rules are strictly separated from high-level compiler experimental features.
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
export class SimplicityOverviewComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  overview: SimplicityOverview | null = null;
  private sub?: Subscription;

  constructor(
    private simplicityApi: SimplicityApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.simplicityApi.getOverview$().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load Simplicity overview';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
