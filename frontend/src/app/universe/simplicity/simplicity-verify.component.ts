import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SimplicityApiService } from './simplicity.service';

@Component({
  selector: 'app-simplicity-verify',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Simplicity Formal Proof Verifier</h1>
          <span class="badge bg-success">Coq / Lean Machine Check</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Cryptographically verify machine-checked formal proofs binding high-level mathematical specifications to exact Simplicity commitment roots.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/liquid/simplicity">Overview</a>
          <a class="nav-link" routerLink="/liquid/simplicity/contracts">Contract Programs</a>
          <a class="nav-link" routerLink="/tools/simplicity">Compiler Workbench</a>
          <a class="nav-link active" routerLink="/tools/simplicity/verify">Formal Proof Verifier</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Proof Package Manifest</h2>
            <p class="small text-muted mb-3">
              Submit a formal proof manifest committing to the program CMR, theorem statement, and interactive theorem prover artifact.
            </p>

            <div class="mb-3">
              <label class="form-label small text-muted">Proof Manifest JSON</label>
              <textarea
                class="form-control font-monospace small"
                rows="14"
                [(ngModel)]="manifestInput"
              ></textarea>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-primary" (click)="verifyProof()" [disabled]="verifying">
                <span *ngIf="verifying" class="spinner-border spinner-border-sm me-1"></span>
                Verify Formal Proof
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load Sample Proof
              </button>
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
              <div class="alert" [ngClass]="result.valid ? 'alert-success' : 'alert-danger'">
                <div class="fw-bold">{{ result.valid ? 'Proof Machine-Checked Successfully' : 'Proof Verification Failed' }}</div>
                <div class="small mt-1" *ngIf="result.valid">Status: {{ result.status }}</div>
                <div class="small mt-1" *ngIf="!result.valid">{{ result.reason || 'Verification failure' }}</div>
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

              <div class="alert alert-info py-2 px-3 small m-0">
                A contract is only displayed as formally verified when its proof dependencies match pinned revisions and the verification transcript is confirmed.
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
export class SimplicityVerifyComponent {
  manifestInput = '';
  verifying = false;
  result: any = null;

  constructor(
    private simplicityApi: SimplicityApiService,
    private cdr: ChangeDetectorRef
  ) {
    this.loadSample();
  }

  loadSample(): void {
    this.manifestInput = JSON.stringify(
      {
        program_cmr: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
        proof_system: 'coq-8.18',
        statement: 'Theorem vault_safety: forall w, eval(cmr, w) = true -> authorized(w).',
        artifact_hash: '99887766554433221100aabbccddeeff99887766554433221100aabbccddeeff',
        libsimplicity_revision: 'v0.2.0',
      },
      null,
      2
    );
  }

  verifyProof(): void {
    this.verifying = true;
    this.result = null;
    let pkg: any;
    try {
      pkg = JSON.parse(this.manifestInput);
    } catch (e) {
      this.verifying = false;
      this.result = {
        valid: false,
        status: 'proof_failed',
        reason: 'Malformed JSON manifest',
      };
      this.cdr.markForCheck();
      return;
    }

    this.simplicityApi.verifyFormalProof$(pkg).subscribe({
      next: (res) => {
        this.result = res;
        this.verifying = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.verifying = false;
        this.result = {
          valid: false,
          status: 'proof_failed',
          reason: err.message || 'Verification service failure',
        };
        this.cdr.markForCheck();
      },
    });
  }
}
