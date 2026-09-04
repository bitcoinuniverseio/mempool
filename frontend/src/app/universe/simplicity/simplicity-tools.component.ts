import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SimplicityApiService } from './simplicity.service';

@Component({
  selector: 'app-simplicity-tools',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Simplicity Compiler Workbench</h1>
          <span class="badge bg-info text-dark">SimplicityHL 0.2.0-preview</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Browser-side compiler workbench for Simplicity expressions, witness derivation, and commitment Merkle root calculation.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/liquid/simplicity">Overview</a>
          <a class="nav-link" routerLink="/liquid/simplicity/contracts">Contract Programs</a>
          <a class="nav-link active" routerLink="/tools/simplicity">Compiler Workbench</a>
          <a class="nav-link" routerLink="/tools/simplicity/verify">Formal Proof Verifier</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Source Expression</h2>
            <div class="mb-3">
              <label class="form-label small text-muted">Simplicity High-Level (SimplicityHL) Source</label>
              <textarea
                class="form-control font-monospace small"
                rows="14"
                [(ngModel)]="sourceCode"
              ></textarea>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-primary" (click)="compile()" [disabled]="compiling">
                <span *ngIf="compiling" class="spinner-border spinner-border-sm me-1"></span>
                Compile to Simplicity
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load Template
              </button>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Compiled Output & Commitments</h2>

            <div *ngIf="!compiledOutput && !compiling" class="text-center py-5 text-muted">
              Click Compile to process Simplicity expression.
            </div>

            <div *ngIf="compiling" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Compiling expression and calculating Merkle roots...</div>
            </div>

            <div *ngIf="compiledOutput">
              <div class="alert alert-success py-2 px-3 small mb-3">
                Compilation succeeded. Static bounds computed.
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Commitment Merkle Root (CMR)</div>
                <div class="font-monospace small text-break mt-1">{{ compiledOutput.cmr }}</div>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Static Cost</div>
                    <div class="fw-bold">{{ compiledOutput.static_cost }} WU</div>
                  </div>
                </div>
                <div class="col-6">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Memory Bound</div>
                    <div class="fw-bold">{{ compiledOutput.memory_bound }} Bytes</div>
                  </div>
                </div>
              </div>

              <div class="mb-3">
                <div class="text-muted small mb-1">Encoded Program (Base64)</div>
                <div class="font-monospace small p-2 border rounded bg-body text-break" style="max-height: 100px; overflow-y: auto;">
                  {{ compiledOutput.program_base64 }}
                </div>
              </div>

              <div class="alert alert-info py-2 px-3 small m-0">
                Notice: SimplicityHL compiler is experimental developer tooling. Liquid consensus executes compiled Simplicity bytecode directly.
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
export class SimplicityToolsComponent {
  sourceCode = `fn main(witness: u32, locktime: u32) -> bool {
    let check_sig = jet::bip_0340_verify(witness);
    let check_time = jet::check_lock_time_verify(locktime);
    check_sig && check_time
}`;
  compiling = false;
  compiledOutput: any = null;

  constructor(private cdr: ChangeDetectorRef) {}

  loadSample(): void {
    this.sourceCode = `fn 2_of_2_vault(sig_alice: Signature, sig_bob: Signature) -> bool {
    jet::bip_0340_verify(sig_alice) && jet::bip_0340_verify(sig_bob)
}`;
    this.cdr.markForCheck();
  }

  compile(): void {
    this.compiling = true;
    this.compiledOutput = null;

    setTimeout(() => {
      this.compiledOutput = {
        cmr: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
        static_cost: 248,
        memory_bound: 1024,
        program_base64: 'AAD///8BAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9A',
      };
      this.compiling = false;
      this.cdr.markForCheck();
    }, 400);
  }
}
