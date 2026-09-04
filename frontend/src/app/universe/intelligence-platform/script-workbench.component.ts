import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-script-workbench',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Bitcoin Script, Descriptor, Miniscript, and PSBT Workbench</h1>
          <span class="badge badge-primary">Developer Tool</span>
        </div>
        <p class="subtitle">
          Disassemble scripts, simulate opcode stack execution, compile Miniscript policies, derive output descriptors, and inspect partially signed Bitcoin transactions.
        </p>
      </header>

      <!-- Tab Navigation -->
      <ul class="nav nav-tabs mb-4" role="tablist">
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 'script'" (click)="activeTab = 'script'" role="tab" [attr.aria-selected]="activeTab === 'script'">Script Analyzer</button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 'descriptor'" (click)="activeTab = 'descriptor'" role="tab" [attr.aria-selected]="activeTab === 'descriptor'">Descriptor Engine</button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 'psbt'" (click)="activeTab = 'psbt'" role="tab" [attr.aria-selected]="activeTab === 'psbt'">PSBT Inspector</button>
        </li>
      </ul>

      <!-- Loading State -->
      <div *ngIf="loading" class="card p-4 text-center mb-4" role="status">
        <div class="spinner-border text-primary mx-auto" role="status"></div>
        <p class="mt-2 text-muted mb-0">Analyzing transaction payload...</p>
      </div>

      <!-- Script Analyzer Tab -->
      <div *ngIf="activeTab === 'script'">
        <section class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <h4 class="h5 mb-0">Analyze Script Hex</h4>
            <button class="btn btn-sm btn-outline-secondary" (click)="loadSampleScript()">Load Sample</button>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <label for="script-hex-input" class="form-label small text-muted">Script Hex</label>
              <input
                id="script-hex-input"
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="scriptInput"
                placeholder="0014751e76e8199196d454941c45d1b3a323f1433bd6"
              />
            </div>
            <button class="btn btn-primary" [disabled]="loading || !scriptInput.trim()" (click)="analyzeScript()">Analyze Script</button>
          </div>
        </section>

        <!-- Initial Empty State -->
        <div *ngIf="!scriptResult && !loading" class="card p-4 text-center text-muted mb-4">
          Enter a script hex string above and click "Analyze Script" to disassemble opcodes and simulate execution.
        </div>

        <section *ngIf="scriptResult && !loading" class="card mb-4">
          <div class="card-header">
            <h4 class="h5 mb-0">Script Analysis</h4>
          </div>
          <div class="card-body">
            <div class="row g-3 mb-3">
              <div class="col-sm-4 col-12">
                <div class="text-muted small">Standardness</div>
                <span class="badge" [ngClass]="scriptResult.is_standard ? 'badge-success' : 'badge-warning'">
                  {{ scriptResult.is_standard ? 'Standard Script' : 'Non-Standard' }}
                </span>
              </div>
              <div class="col-sm-4 col-12">
                <div class="text-muted small">Pattern Type</div>
                <div class="fw-bold">{{ scriptResult.script_type }}</div>
              </div>
              <div class="col-sm-4 col-12">
                <div class="text-muted small">Opcode Count</div>
                <div class="fw-bold">{{ scriptResult.opcodes_count }}</div>
              </div>
            </div>

            <div class="mb-3">
              <div class="text-muted small mb-1">Disassembled ASM</div>
              <pre class="p-3 bg-dark-subtle rounded font-monospace small overflow-auto text-break">{{ scriptResult.asm }}</pre>
            </div>

            <div *ngIf="scriptResult.stack_execution?.length > 0">
              <h5 class="h6 mb-2">Simulated Stack Trace</h5>
              <div class="table-responsive">
                <table class="table table-sm table-hover mb-0">
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">Opcode</th>
                      <th scope="col">Stack After</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let step of scriptResult.stack_execution">
                      <td>{{ step.step }}</td>
                      <td class="font-monospace text-primary">{{ step.opcode }}</td>
                      <td class="font-monospace small text-break">{{ step.stack_after?.join(', ') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Descriptor Engine Tab -->
      <div *ngIf="activeTab === 'descriptor'">
        <section class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <h4 class="h5 mb-0">Output Descriptor & Miniscript</h4>
            <button class="btn btn-sm btn-outline-secondary" (click)="loadSampleDescriptor()">Load Sample</button>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <label for="descriptor-input" class="form-label small text-muted">Descriptor Expression</label>
              <input
                id="descriptor-input"
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="descriptorInput"
                placeholder="wpkh([d34db33f/84h/0h/0h]xpub.../0/*)#checksum"
              />
            </div>
            <button class="btn btn-primary" [disabled]="loading || !descriptorInput.trim()" (click)="parseDescriptor()">Parse Descriptor</button>
          </div>
        </section>

        <!-- Initial Empty State -->
        <div *ngIf="!descriptorResult && !loading" class="card p-4 text-center text-muted mb-4">
          Enter an output descriptor expression and click "Parse Descriptor" to view policy validation and derivation paths.
        </div>

        <section *ngIf="descriptorResult && !loading" class="card mb-4">
          <div class="card-header">
            <h4 class="h5 mb-0">Parsed Descriptor</h4>
          </div>
          <div class="card-body">
            <div class="row g-3 mb-3">
              <div class="col-sm-4 col-12">
                <div class="text-muted small">Validity</div>
                <span class="badge" [ngClass]="descriptorResult.valid ? 'badge-success' : 'badge-danger'">
                  {{ descriptorResult.valid ? 'Valid Descriptor' : 'Invalid' }}
                </span>
              </div>
              <div class="col-sm-4 col-12">
                <div class="text-muted small">Type</div>
                <div class="fw-bold">{{ descriptorResult.descriptor_type }}</div>
              </div>
              <div class="col-sm-4 col-12">
                <div class="text-muted small">Miniscript Policy</div>
                <div class="font-monospace small text-break">{{ descriptorResult.miniscript_policy }}</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- PSBT Tab -->
      <div *ngIf="activeTab === 'psbt'">
        <section class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <h4 class="h5 mb-0">PSBT Hex or Base64</h4>
            <button class="btn btn-sm btn-outline-secondary" (click)="loadSamplePsbt()">Load Sample</button>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <label for="psbt-input" class="form-label small text-muted">PSBT Payload</label>
              <textarea
                id="psbt-input"
                class="form-control font-monospace"
                rows="4"
                [(ngModel)]="psbtInput"
                placeholder="Paste PSBT hex or base64..."
              ></textarea>
            </div>
            <button class="btn btn-primary" [disabled]="loading || !psbtInput.trim()" (click)="inspectPsbt()">Inspect PSBT</button>
          </div>
        </section>

        <!-- Initial Empty State -->
        <div *ngIf="!psbtResult && !loading" class="card p-4 text-center text-muted mb-4">
          Enter a partially signed Bitcoin transaction payload and click "Inspect PSBT" to evaluate signatures, inputs, and fees.
        </div>

        <section *ngIf="psbtResult && !loading" class="card mb-4">
          <div class="card-header">
            <h4 class="h5 mb-0">PSBT Inspection Result</h4>
          </div>
          <div class="card-body">
            <div class="row g-3">
              <div class="col-sm-3 col-6">
                <div class="text-muted small">Inputs</div>
                <div class="h5 mb-0">{{ psbtResult.inputs_count }}</div>
              </div>
              <div class="col-sm-3 col-6">
                <div class="text-muted small">Outputs</div>
                <div class="h5 mb-0">{{ psbtResult.outputs_count }}</div>
              </div>
              <div class="col-sm-3 col-6">
                <div class="text-muted small">Fee (sats)</div>
                <div class="h5 mb-0">{{ psbtResult.fee_sats | number }}</div>
              </div>
              <div class="col-sm-3 col-6">
                <div class="text-muted small">Status</div>
                <span class="badge" [ngClass]="psbtResult.is_finalized ? 'badge-success' : 'badge-warning'">
                  {{ psbtResult.is_finalized ? 'Finalized' : 'Pending Signatures' }}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .intelligence-page { padding-top: 2rem; padding-bottom: 4rem; }
    .page-header { margin-bottom: 2rem; }
    .title-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .badge {
      display: inline-block; padding: 0.35em 0.65em; font-size: 0.75em;
      font-weight: 700; line-height: 1; text-align: center; white-space: nowrap;
      vertical-align: baseline; border-radius: 0.25rem;
    }
    .badge-primary { background-color: var(--bs-primary, #0d6efd); color: #fff; }
    .badge-success { background-color: var(--bs-success, #198754); color: #fff; }
    .badge-warning { background-color: var(--bs-warning, #ffc107); color: #000; }
    .badge-danger { background-color: var(--bs-danger, #dc3545); color: #fff; }
    .bg-dark-subtle { background-color: var(--bs-dark-bg-subtle, rgba(255,255,255,0.05)); }
  `],
})
export class ScriptWorkbenchComponent implements OnInit {
  activeTab = 'script';
  scriptInput = '';
  descriptorInput = '';
  psbtInput = '';

  loading = false;
  scriptResult: any = null;
  descriptorResult: any = null;
  psbtResult: any = null;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Initial load displays empty interactive forms without executing background requests
  }

  loadSampleScript(): void {
    this.scriptInput = '0014751e76e8199196d454941c45d1b3a323f1433bd6';
    this.cdr.markForCheck();
  }

  loadSampleDescriptor(): void {
    this.descriptorInput = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZtsWPgv2EZpqRz12345/0/*)#abc12345';
    this.cdr.markForCheck();
  }

  loadSamplePsbt(): void {
    this.psbtInput = '70736274ff0100520200000001000000';
    this.cdr.markForCheck();
  }

  analyzeScript(): void {
    if (!this.scriptInput.trim()) return;
    this.loading = true;
    this.cdr.markForCheck();

    this.api.analyzeScript$(this.scriptInput).subscribe({
      next: (res) => {
        this.scriptResult = res;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  parseDescriptor(): void {
    if (!this.descriptorInput.trim()) return;
    this.loading = true;
    this.cdr.markForCheck();

    this.api.parseDescriptor$(this.descriptorInput).subscribe({
      next: (res) => {
        this.descriptorResult = res;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  inspectPsbt(): void {
    if (!this.psbtInput.trim()) return;
    this.loading = true;
    this.cdr.markForCheck();

    this.api.analyzePsbt$(this.psbtInput).subscribe({
      next: (res) => {
        this.psbtResult = res;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }
}
