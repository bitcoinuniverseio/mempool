import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SimplicityApiService, SimplicityProgram } from './simplicity.service';

@Component({
  selector: 'app-simplicity-program-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a routerLink="/liquid/simplicity/contracts" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Programs
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="program">
          <div>
            <h1 class="m-0">{{ program.source_name || program.program_id }}</h1>
            <div class="text-muted small font-monospace mt-1">{{ program.program_id }}</div>
          </div>
          <span class="badge" [ngClass]="program.is_formally_verified ? 'bg-success' : 'bg-secondary'">
            {{ program.is_formally_verified ? 'FORMALLY VERIFIED' : 'UNVERIFIED' }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading program details...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && program" class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border mb-4">
            <h2 class="h5 mb-3">Commitment Roots & Static Analysis</h2>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Commitment Merkle Root (CMR)</div>
              <div class="font-monospace small text-break mt-1">{{ program.cmr }}</div>
            </div>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Identity Merkle Root (IMR)</div>
              <div class="font-monospace small text-break mt-1">{{ program.imr }}</div>
            </div>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Annotated Merkle Root (AMR)</div>
              <div class="font-monospace small text-break mt-1">{{ program.amr }}</div>
            </div>
            <div class="row g-2">
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Static Weight</div>
                  <div class="fw-bold">{{ program.static_cost_weight }} WU</div>
                </div>
              </div>
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Memory Bound</div>
                  <div class="fw-bold">{{ program.memory_bound_bytes }} Bytes</div>
                </div>
              </div>
            </div>
          </div>

          <div class="card p-4 bg-body-tertiary border">
            <h2 class="h5 mb-3">Recognized Jets</h2>
            <p class="small text-muted mb-2">
              Optimized primitives accelerating Simplicity program evaluation without changing formal semantics:
            </p>
            <div class="d-flex flex-wrap gap-2">
              <span *ngFor="let jet of program.jets_used" class="badge bg-body border text-body p-2 font-monospace">
                {{ jet }}
              </span>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Program Provenance</h2>
            <dl class="row mb-0">
              <dt class="col-sm-5 text-muted">Program Type</dt>
              <dd class="col-sm-7"><span class="badge bg-secondary">{{ program.program_type }}</span></dd>

              <dt class="col-sm-5 text-muted">Occurrences</dt>
              <dd class="col-sm-7 font-monospace">{{ program.occurrences_count }} spends observed</dd>

              <dt class="col-sm-5 text-muted" *ngIf="program.first_seen_height">First Seen</dt>
              <dd class="col-sm-7 font-monospace" *ngIf="program.first_seen_height">Block #{{ program.first_seen_height }}</dd>

              <dt class="col-sm-5 text-muted">Formal Proof</dt>
              <dd class="col-sm-7">
                <span *ngIf="program.is_formally_verified" class="text-success small fw-bold">
                  Checked with Coq / Lean
                </span>
                <span *ngIf="!program.is_formally_verified" class="text-muted small">
                  No proof artifact registered
                </span>
              </dd>
            </dl>

            <div class="mt-4 pt-3 border-top d-flex gap-2">
              <a [routerLink]="['/tools/simplicity']" class="btn btn-sm btn-outline-primary">
                Open in Workbench
              </a>
              <a [routerLink]="['/tools/simplicity/verify']" class="btn btn-sm btn-outline-secondary">
                Verify Proof Artifact
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SimplicityProgramDetailComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  program: SimplicityProgram | null = null;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private simplicityApi: SimplicityApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const programId = this.route.snapshot.paramMap.get('programId') || 'sim-multisig-v1';
    this.sub = this.simplicityApi.getProgramById$(programId).subscribe({
      next: (data) => {
        this.program = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load program detail';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
