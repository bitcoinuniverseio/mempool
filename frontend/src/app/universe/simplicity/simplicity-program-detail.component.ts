import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription, combineLatest, startWith, switchMap, map, catchError, of } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SimplicityApiService, SimplicityProgram } from './simplicity.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-simplicity-program-detail',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a [routerLink]="'/liquid/simplicity/contracts' | relativeUrl" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Programs
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="program">
          <div>
            <h1 class="m-0">{{ program.program_name || program.program_id }}</h1>
            <div class="text-muted small font-monospace mt-1">{{ program.program_id }}</div>
          </div>
          <span class="badge" [ngClass]="(program.formal_verification_state === 'proof_checked') ? 'bg-success' : 'bg-secondary'">
            {{ (program.formal_verification_state === 'proof_checked') ? 'FORMALLY VERIFIED' : 'UNVERIFIED' }}
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
                  <div class="fw-bold">{{ program.resource_bounds.max_cost_weight }} WU</div>
                </div>
              </div>
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Memory Cell Bound</div>
                  <div class="fw-bold">{{ program.resource_bounds.max_memory_cells }} cells</div>
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
              <span *ngFor="let jet of program.jets" class="badge bg-body border text-body p-2 font-monospace">
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
                <span *ngIf="(program.formal_verification_state === 'proof_checked')" class="text-success small fw-bold">
                  Checked profile: {{ program.provenance.proof_system || 'Not supplied' }}
                </span>
                <span *ngIf="!(program.formal_verification_state === 'proof_checked')" class="text-muted small">
                  No proof artifact registered
                </span>
              </dd>
            </dl>

            <div class="mt-4 pt-3 border-top d-flex gap-2">
              <a [routerLink]="['/tools/simplicity' | relativeUrl]" class="btn btn-sm btn-outline-primary">
                Open in Workbench
              </a>
              <a [routerLink]="['/tools/simplicity/verify' | relativeUrl]" class="btn btn-sm btn-outline-secondary">
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
    private cdr: ChangeDetectorRef,
    private state: StateService
  ) {}

  ngOnInit(): void {
    this.sub = combineLatest([this.route.paramMap, this.state.networkChanged$.pipe(startWith(this.state.network))]).pipe(switchMap(([params]) => {
      this.program = null; this.error = null; this.loading = true; this.cdr.markForCheck();
      const id = params.get('programId');
      if (!id || id.length > 256) { this.error = 'A program identity is required.'; return of(null); }
      return this.simplicityApi.getProgramById$(id).pipe(map(value => {
        if (value?.program_id !== id || !value.resource_bounds || !Array.isArray(value.jets)) throw Error('Mismatched program');
        return value;
      }), catchError(() => { this.error = 'Program index evidence is unavailable or does not match this identity.'; return of(null); }));
    })).subscribe(value => { this.program = value; this.loading = false; this.cdr.markForCheck(); });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
