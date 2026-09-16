import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SimplicityCompilerService, SimplicityCompiledOutput } from './simplicity-compiler.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-simplicity-tools',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Simplicity Compiler Workbench</h1>
          <span class="badge bg-info text-dark">SimplicityHL 0.2.0 / rust-simplicity 0.5.0</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Browser-side compiler workbench for Simplicity expressions, witness derivation, and commitment Merkle root calculation.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/liquid/simplicity' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/liquid/simplicity/contracts' | relativeUrl">Contract Programs</a>
          <a class="nav-link active" [routerLink]="'/tools/simplicity' | relativeUrl">Compiler Workbench</a>
          <a class="nav-link" [routerLink]="'/tools/simplicity/verify' | relativeUrl">Formal Proof Verifier</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Source Expression</h2>
            <div class="mb-3">
              <label class="form-label small text-muted" for="simplicity-tools-source">Simplicity High-Level (SimplicityHL) Source</label>
              <textarea
                id="simplicity-tools-source"
                class="form-control font-monospace small"
                rows="14"
                [(ngModel)]="sourceCode"
                (ngModelChange)="edited()"
              ></textarea>
            </div>

            <label for="simplicity-arguments">Parameters JSON (name: value/type)</label>
            <textarea id="simplicity-arguments" class="form-control font-monospace mb-2" [(ngModel)]="argumentsJson" (ngModelChange)="edited()" rows="2"></textarea>
            <label for="simplicity-witness">Witness JSON (name: value/type; stays in browser)</label>
            <textarea id="simplicity-witness" class="form-control font-monospace mb-2" [(ngModel)]="witnessJson" (ngModelChange)="edited()" rows="2" autocomplete="off"></textarea>
            <p class="small text-muted">Example: {{ '{"VALUE":{"value":"42","type":"u32"}}' }}. Compilation and witness serialization do not execute the contract or prove its behavior.</p>
            <p *ngIf="error" class="text-danger" role="alert">{{ error }}</p>

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
                    <div class="fw-bold">{{ compiledOutput.static_cost }} milliweight units</div>
                  </div>
                </div>
                <div class="col-6">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Memory Bound</div>
                    <div class="fw-bold">{{ compiledOutput.memory_bound }} bits, {{ compiledOutput.extra_frames }} extra frames</div>
                  </div>
                </div>
              </div>

              <div class="small text-muted mb-2">Program type: {{ compiledOutput.program_type }}. Encoded program re-decoded and CMR matched.</div>
              <div class="small mb-3">Serialized witness (Base64): <span class="font-monospace text-break">{{ compiledOutput.witness_base64 || '(empty)' }}</span></div>

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
export class SimplicityToolsComponent implements OnDestroy {
  sourceCode = 'fn main() {\n    let value: u32 = 42;\n    assert!(jet::eq_32(value, 42));\n}';
  argumentsJson = '{}';
  witnessJson = '{}';
  compiling = false;
  compiledOutput: SimplicityCompiledOutput | null = null;
  error: string | null = null;
  private generation = 0;
  private cancel: (() => void) | null = null;
  constructor(private cdr: ChangeDetectorRef, private compiler: SimplicityCompilerService) {}
  edited(): void {
    this.generation++; this.cancel?.(); this.cancel = null;
    this.compiling = false; this.compiledOutput = null; this.error = null;
  }
  loadSample(): void {
    this.edited();
    this.sourceCode = 'fn main() {\n    let value: u32 = witness::VALUE;\n    assert!(jet::eq_32(value, 42));\n}';
    this.argumentsJson = '{}';
    this.witnessJson = '{"VALUE":{"value":"42","type":"u32"}}';
    this.cdr.markForCheck();
  }
  async compile(): Promise<void> {
    this.edited(); const generation = this.generation; this.compiling = true;
    const task = this.compiler.compile(this.sourceCode, this.argumentsJson, this.witnessJson); this.cancel = task.cancel;
    try { const result = await task.promise; if (generation === this.generation) this.compiledOutput = result; }
    catch (error) { if (generation === this.generation) this.error = error instanceof Error ? error.message : 'Compilation failed.'; }
    finally { if (generation === this.generation) { this.compiling = false; this.cancel = null; this.cdr.markForCheck(); } }
  }
  ngOnDestroy(): void { this.edited(); this.witnessJson = '{}'; }
}