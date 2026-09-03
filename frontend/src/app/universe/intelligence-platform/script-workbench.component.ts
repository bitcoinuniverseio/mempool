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
      <ul class="nav nav-tabs mb-4">
        <li class="nav-item">
          <button class="nav-link" [class.active]="activeTab === 'script'" (click)="activeTab = 'script'">Script Analyzer</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" [class.active]="activeTab === 'descriptor'" (click)="activeTab = 'descriptor'">Descriptor Engine</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" [class.active]="activeTab === 'psbt'" (click)="activeTab = 'psbt'">PSBT Inspector</button>
        </li>
      </ul>

      <!-- Script Analyzer Tab -->
      <div *ngIf="activeTab === 'script'">
        <section class="card mb-4">
          <div class="card-header">
            <h4 class="mb-0">Analyze Script Hex</h4>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <input
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="scriptInput"
                placeholder="0014751e76e8199196d454941c45d1b3a323f1433bd6"
              />
            </div>
            <button class="btn btn-primary" (click)="analyzeScript()">Analyze Script</button>
          </div>
        </section>

        <section *ngIf="scriptResult" class="card mb-4">
          <div class="card-header">
            <h4 class="mb-0">Script Analysis</h4>
          </div>
          <div class="card-body">
            <div class="row g-3 mb-3">
              <div class="col-md-3">
                <span class="text-muted small">Script Type</span>
                <div class="fw-bold text-uppercase">{{ scriptResult.script_type }}</div>
              </div>
              <div class="col-md-3">
                <span class="text-muted small">Standardness</span>
                <div>
                  <span class="badge" [ngClass]="scriptResult.is_standard ? 'badge-success' : 'badge-danger'">
                    {{ scriptResult.is_standard ? 'Standard' : 'Non-Standard' }}
                  </span>
                </div>
              </div>
              <div class="col-md-3">
                <span class="text-muted small">Max Satisfaction Weight</span>
                <div class="fw-bold">{{ scriptResult.max_satisfaction_weight }} WU</div>
              </div>
              <div class="col-md-3">
                <span class="text-muted small">Opcode Count</span>
                <div class="fw-bold">{{ scriptResult.op_count }}</div>
              </div>
            </div>
            <div>
              <span class="text-muted small">Disassembly ASM:</span>
              <pre class="bg-dark-subtle p-3 rounded font-monospace mt-1 mb-0">{{ scriptResult.asm }}</pre>
            </div>
          </div>
        </section>
      </div>

      <!-- Descriptor Engine Tab -->
      <div *ngIf="activeTab === 'descriptor'">
        <section class="card mb-4">
          <div class="card-header">
            <h4 class="mb-0">Parse Output Descriptor</h4>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <input
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="descriptorInput"
                placeholder="wpkh([d34db33f/84h/0h/0h]xpub6ERApfZtsWPgv2EZpqRz12345/0/*)#checksum"
              />
            </div>
            <button class="btn btn-primary" (click)="parseDescriptor()">Derive Addresses</button>
          </div>
        </section>

        <section *ngIf="descriptorResult" class="card mb-4">
          <div class="card-header">
            <h4 class="mb-0">Derived Addresses</h4>
          </div>
          <div class="table-responsive">
            <table class="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Index</th>
                  <th>Derived Bitcoin Address</th>
                  <th>scriptPubKey Hex</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let sample of descriptorResult.derived_samples">
                  <td>#{{ sample.index }}</td>
                  <td class="font-monospace fw-bold">{{ sample.address }}</td>
                  <td class="font-monospace small text-muted">{{ sample.script_pub_key }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- PSBT Inspector Tab -->
      <div *ngIf="activeTab === 'psbt'">
        <section class="card mb-4">
          <div class="card-header">
            <h4 class="mb-0">Inspect Partially Signed Bitcoin Transaction (PSBT)</h4>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <textarea
                class="form-control font-monospace"
                rows="4"
                [(ngModel)]="psbtInput"
                placeholder="cHNidP8BAFICAAAAAQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA..."
              ></textarea>
            </div>
            <button class="btn btn-primary" (click)="inspectPsbt()">Inspect PSBT</button>
          </div>
        </section>

        <section *ngIf="psbtResult" class="card mb-4">
          <div class="card-header">
            <h4 class="mb-0">PSBT Details</h4>
          </div>
          <div class="card-body">
            <div class="row g-3">
              <div class="col-md-3">
                <span class="text-muted small">Status</span>
                <div>
                  <span class="badge" [ngClass]="psbtResult.is_complete ? 'badge-success' : 'badge-warning'">
                    {{ psbtResult.is_complete ? 'Fully Signed' : 'Signatures Pending' }}
                  </span>
                </div>
              </div>
              <div class="col-md-3">
                <span class="text-muted small">Inputs / Outputs</span>
                <div class="fw-bold">{{ psbtResult.input_count }} in / {{ psbtResult.output_count }} out</div>
              </div>
              <div class="col-md-3">
                <span class="text-muted small">Total Fee</span>
                <div class="fw-bold">{{ psbtResult.total_fee_sats | number }} sats</div>
              </div>
              <div class="col-md-3">
                <span class="text-muted small">Feerate</span>
                <div class="fw-bold text-primary">{{ psbtResult.feerate_sats_vb }} sat/vB</div>
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
    .badge-primary { background-color: #0d6efd; color: #fff; }
    .badge-success { background-color: #198754; color: #fff; }
    .badge-warning { background-color: #ffc107; color: #000; }
    .badge-danger { background-color: #dc3545; color: #fff; }
  `],
})
export class ScriptWorkbenchComponent implements OnInit {
  activeTab = 'script';
  scriptInput = '0014751e76e8199196d454941c45d1b3a323f1433bd6';
  descriptorInput = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZtsWPgv2EZpqRz12345/0/*)#abc12345';
  psbtInput = '70736274ff0100520200000001000000';

  scriptResult: any = null;
  descriptorResult: any = null;
  psbtResult: any = null;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.analyzeScript();
    this.parseDescriptor();
    this.inspectPsbt();
  }

  analyzeScript(): void {
    this.api.analyzeScript$(this.scriptInput).subscribe((res) => {
      this.scriptResult = res;
      this.cdr.markForCheck();
    });
  }

  parseDescriptor(): void {
    this.api.parseDescriptor$(this.descriptorInput).subscribe((res) => {
      this.descriptorResult = res;
      this.cdr.markForCheck();
    });
  }

  inspectPsbt(): void {
    this.api.analyzePsbt$(this.psbtInput).subscribe((res) => {
      this.psbtResult = res;
      this.cdr.markForCheck();
    });
  }
}
