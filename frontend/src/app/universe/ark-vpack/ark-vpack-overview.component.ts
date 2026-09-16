import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { ArkVpackApiService, isVpackOverview, VpackOverview } from './ark-vpack.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-ark-vpack-overview',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <div class="alert alert-warning" role="alert" *ngIf="loadError">
        {{ loadError }}
      </div>
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Ark V-PACK, VTXO Portability & Unilateral Exit Center</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            {{ overview.active_providers_count }} Registered ASPs
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Inspect native VTXO proofs, preserve them in MVV envelopes, and plan transaction packages. Protocol validity and exit readiness require additional evidence.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" [routerLink]="'/ark/vpack' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/ark/vpack/verify' | relativeUrl">Verify Anchor</a>
          <a class="nav-link" [routerLink]="'/ark/vpack/translate' | relativeUrl">Translate Dialect</a>
          <a class="nav-link" [routerLink]="'/ark/backups' | relativeUrl">Encrypted Backups</a>
          <a class="nav-link" [routerLink]="'/ark/exit' | relativeUrl">Unilateral Exit</a>
          <a class="nav-link" [routerLink]="'/ark/exit/simulate' | relativeUrl">Exit Simulator</a>
          <a class="nav-link" [routerLink]="'/ark/providers' | relativeUrl">ASP Registry</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Ark V-PACK overview...</div>
      </div>

      <p *ngIf="overview?.observation_scope" class="text-muted">{{ overview.observation_scope }}</p>
      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Supported proof formats</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_vpack_versions }}</div>
            <div class="small text-muted mt-1">{{ overview.active_versions.join(', ') || 'None reported' }}</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Registered ASPs</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.active_providers_count }}</div>
            <div class="small text-muted mt-1">{{ overview.registry_status || 'Source status not supplied' }}</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Observed anchor outputs</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.recent_verified_anchors }}</div>
            <div class="small text-info mt-1">Successful owned-source reads</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Portability Dialects</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.supported_implementations.length }}</div>
            <div class="small text-muted mt-1">Pinned native codecs</div>
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
                  <a [routerLink]="'/ark/vpack/translate' | relativeUrl" class="btn btn-sm btn-outline-secondary">Translate to MVV</a>
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
  private requestSub?: Subscription;

  public loadError: string | null = null;

  constructor(private api: ArkVpackApiService, private cdr: ChangeDetectorRef) {}

  public ngOnInit(): void {
    this.sub = this.api.networkChanges$.subscribe(() => {
      this.requestSub?.unsubscribe();
      this.overview = null;
      this.loading = true;
      this.loadError = null;
      this.cdr.markForCheck();
      this.load();
    });
  }

  private load(): void {
    this.requestSub = this.api.getOverview$().subscribe({
      next: (data) => {
        const valid = isVpackOverview(data);
        this.overview = valid ? data : null;
        this.loading = false;
        this.loadError = valid ? null : 'The Ark V-PACK overview response is malformed. Implementation and version data could not be displayed.';
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.overview = null;
        this.loading = false;
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
        this.cdr.markForCheck();
      },
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.requestSub?.unsubscribe();
  }
}
