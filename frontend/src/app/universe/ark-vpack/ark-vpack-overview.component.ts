import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { ArkVpackApiService, VpackOverview } from './ark-vpack.service';

@Component({
  selector: 'app-ark-vpack-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Ark V-PACK, VTXO Portability & Unilateral Exit Center</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            {{ overview.active_providers_count }} Active ASPs
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Authoritative verification of Minimal Viable VTXO envelopes, cross-dialect portability, and unilateral exit paths.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/ark/vpack">Overview</a>
          <a class="nav-link" routerLink="/ark/vpack/verify">Verify Anchor</a>
          <a class="nav-link" routerLink="/ark/vpack/translate">Translate Dialect</a>
          <a class="nav-link" routerLink="/ark/backups">Encrypted Backups</a>
          <a class="nav-link" routerLink="/ark/exit">Unilateral Exit</a>
          <a class="nav-link" routerLink="/ark/exit/simulate">Exit Simulator</a>
          <a class="nav-link" routerLink="/ark/providers">ASP Registry</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Ark V-PACK overview...</div>
      </div>

      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Standard V-PACK Versions</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_vpack_versions }}</div>
            <div class="small text-success mt-1">MVV v0.1.0 and v0.2.0-rc1</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Observed ASPs</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.active_providers_count }}</div>
            <div class="small text-muted mt-1">Arkade and Bark compliant</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Verified Anchors</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.recent_verified_anchors }}</div>
            <div class="small text-info mt-1">On-chain Bitcoin commitments</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Portability Dialects</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.supported_implementations.length }}</div>
            <div class="small text-muted mt-1">Rust libvpack & Go Bark</div>
          </div>
        </div>

        <div class="col-12">
          <div class="card bg-body-tertiary border p-3">
            <h5 class="card-title mb-3">Supported VTXO Implementation Dialects</h5>
            <div class="row g-3">
              <div class="col-md-6" *ngFor="let impl of overview.supported_implementations">
                <div class="p-3 border rounded bg-body">
                  <div class="d-flex justify-content-between align-items-center mb-2">
                    <h6 class="m-0">{{ impl.implementation_name }}</h6>
                    <span class="badge bg-primary">{{ impl.implementation_revision }}</span>
                  </div>
                  <p class="small text-muted mb-2">Supported V-PACK versions: {{ impl.supported_vpack_versions.join(', ') }}</p>
                  <a routerLink="/ark/vpack/translate" class="btn btn-sm btn-outline-secondary">Translate to MVV</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ArkVpackOverviewComponent implements OnInit, OnDestroy {
  public overview: VpackOverview | null = null;
  public loading = true;
  private sub?: Subscription;

  constructor(private api: ArkVpackApiService, private cdr: ChangeDetectorRef) {}

  public ngOnInit(): void {
    this.sub = this.api.getOverview$().subscribe((data) => {
      this.overview = data;
      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
