import { Subscription } from 'rxjs';
import { FORMAL_PROOF_SAMPLE } from './formal-proof-sample';
import { LEAN_PROOF_SAMPLE } from './lean-proof-sample';
import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SimplicityApiService } from './simplicity.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-simplicity-verify',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Simplicity Formal Proof Verifier</h1>
          <span class="badge bg-success">Bounded Program &amp; Kernel Checks</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Check a bound closed-program claim using independent compiler/C semantics, or a normalized u32 equality with the pinned Lean 4 kernel. General Lean, Coq, Isabelle and Dafny theorem scopes remain unsupported.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/liquid/simplicity' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/liquid/simplicity/contracts' | relativeUrl">Contract Programs</a>
          <a class="nav-link" [routerLink]="'/tools/simplicity' | relativeUrl">Compiler Workbench</a>
          <a class="nav-link active" [routerLink]="'/tools/simplicity/verify' | relativeUrl">Formal Proof Verifier</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Proof Package Manifest</h2>
            <p class="small text-muted mb-3">
              Submit public source, encoded program and a bound certificate. This sends the package to the local backend checker; exclude secrets. Client verification commands are never executed.
            </p>

            <div class="mb-3">
              <label class="form-label small text-muted" for="simplicity-verify-manifest">Proof Manifest JSON</label>
              <textarea
                id="simplicity-verify-manifest"
                class="form-control font-monospace small"
                rows="14"
                [(ngModel)]="manifestInput" (ngModelChange)="edited()"
              ></textarea>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-primary" (click)="verifyProof()" [disabled]="verifying">
                <span *ngIf="verifying" class="spinner-border spinner-border-sm me-1"></span>
                Verify Formal Proof
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load Closed-Program Sample
              </button>
              <button class="btn btn-outline-secondary" (click)="loadLeanSample()">Load Lean Kernel Sample</button>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Proof Check Results</h2>

            <div *ngIf="!result && !verifying" class="text-center py-5 text-muted">
              Submit a proof package manifest to check formal verification.
            </div>

            <div *ngIf="verifying" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Checking proof dependencies, CMR binding, and theorem statements...</div>
            </div>

            <div *ngIf="result">
              <div class="alert" [ngClass]="result.verified ? 'alert-success' : 'alert-danger'">
                <div class="fw-bold">{{ result.verified ? 'Exact Claim Checked' : 'Claim Not Verified' }}</div>
                <div class="small mt-1" *ngIf="result.verified">Status: {{ result.proof_state }}</div>
                <div class="small mt-1" *ngIf="!result.verified">{{ result.message || 'Verification failure' }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Program CMR</div>
                <div class="font-monospace small text-break mt-1">{{ result.program_cmr }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Theorem Statement</div>
                <div class="small font-monospace text-break mt-1">{{ result.statement }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Proof System</div>
                <div class="badge bg-secondary">{{ result.proof_system }}</div>
              </div>

              <div *ngIf="result.kernel_revision" class="p-3 border rounded mb-3"><div>Kernel: {{ result.kernel_revision }}</div><div class="text-muted small">Checked Lean artifact SHA256</div><div class="font-monospace small text-break">{{ result.kernel_artifact_hash }}</div></div>
              <div class="alert alert-info py-2 px-3 small m-0">
                A checked result applies only to the exact statement and supported program profile shown. It does not prove authorization, asset safety, or an arbitrary theorem.
              </div>
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
export class SimplicityVerifyComponent implements OnDestroy {
  manifestInput = '';
  verifying = false;
  result: any = null;
  private generation = 0;
  private request: Subscription | null = null;
  constructor(private simplicityApi: SimplicityApiService, private cdr: ChangeDetectorRef) { this.loadSample(); }
  edited(): void { this.generation++; this.request?.unsubscribe(); this.request = null; this.verifying = false; this.result = null; }
  loadSample(): void { this.edited(); this.manifestInput = JSON.stringify(FORMAL_PROOF_SAMPLE, null, 2); }
  loadLeanSample(): void { this.edited(); this.manifestInput = JSON.stringify(LEAN_PROOF_SAMPLE, null, 2); }
  verifyProof(): void {
    this.edited(); const generation = this.generation; this.verifying = true;
    let pkg: unknown;
    try { if (this.manifestInput.length > 40000) throw new Error(); pkg = JSON.parse(this.manifestInput); }
    catch { this.verifying = false; this.result = { verified: false, proof_state: 'proof_failed', message: 'Malformed or oversized JSON manifest' }; return; }
    this.request = this.simplicityApi.verifyFormalProof$(pkg).subscribe({
      next: (res) => { if (generation !== this.generation) return; this.result = res; this.verifying = false; this.cdr.markForCheck(); },
      error: (err) => { if (generation !== this.generation) return; this.verifying = false; this.result = { verified: false, proof_state: err.error?.stage || 'proof_failed', message: err.error?.error || 'Verification service failure' }; this.cdr.markForCheck(); },
    });
  }
  ngOnDestroy(): void { this.edited(); }
}
