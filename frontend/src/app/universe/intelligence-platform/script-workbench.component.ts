import { Component, Inject, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { Observable, Subscription } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
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
          Read script disassembly, derive public descriptors, request stack execution and Miniscript compilation, and inspect PSBT metadata. Each result states what was evaluated.
        </p>
      </header>

      <!-- Tab Navigation -->
      <ul class="nav nav-tabs mb-4" role="tablist">
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 'script'" (click)="selectTab('script')" role="tab" [attr.aria-selected]="activeTab === 'script'">Script Analyzer</button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 'descriptor'" (click)="selectTab('descriptor')" role="tab" [attr.aria-selected]="activeTab === 'descriptor'">Descriptor Engine</button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" [class.active]="activeTab === 'psbt'" (click)="selectTab('psbt')" role="tab" [attr.aria-selected]="activeTab === 'psbt'">PSBT Inspector</button>
        </li>
        <li class="nav-item" role="presentation" *ngFor="let tab of extraTabs">
          <button class="nav-link" [class.active]="activeTab === tab.id" (click)="selectTab(tab.id)" role="tab" [attr.aria-selected]="activeTab === tab.id">{{ tab.label }}</button>
        </li>
      </ul>

      <!-- Loading State -->
      <div *ngIf="loading" class="card p-4 text-center mb-4" role="status">
        <div class="spinner-border text-primary mx-auto" role="status"></div>
        <p class="mt-2 text-muted mb-0">Analyzing transaction payload...</p>
      </div>

      <div *ngIf="loadError" class="alert alert-danger mb-4" role="alert">
        {{ loadError }}
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
                [(ngModel)]="scriptInput" (ngModelChange)="invalidateResults()"
                placeholder="0014751e76e8199196d454941c45d1b3a323f1433bd6"
              />
            </div>
            <button class="btn btn-primary" [disabled]="loading || !scriptInput.trim()" (click)="analyzeScript()">Analyze Script</button>
          </div>
        </section>

        <!-- Initial Empty State -->
        <div *ngIf="!scriptResult && !loading" class="card p-4 text-center text-muted mb-4">
          Enter a script hex string above and click "Analyze Script" to disassemble opcodes. Spending validity requires transaction context.
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
                  {{ scriptResult.is_standard === null ? 'Not evaluated' : scriptResult.is_standard ? 'Standard Script' : 'Non-Standard' }}
                </span>
              </div>
              <div class="col-sm-4 col-12">
                <div class="text-muted small">Pattern Type</div>
                <div class="fw-bold">{{ scriptResult.script_type }}</div>
              </div>
              <div class="col-sm-4 col-12">
                <div class="text-muted small">Opcode Count</div>
                <div class="fw-bold">{{ scriptResult.op_count }}</div>
              </div>
            </div>

            <div class="mb-3">
              <div class="text-muted small mb-1">Disassembled ASM</div>
              <pre class="p-3 bg-dark-subtle rounded font-monospace small overflow-auto text-break">{{ scriptResult.asm }}</pre>
            </div>

            <p>{{ scriptResult.analysis_scope }}</p>
            <ul><li *ngFor="let warning of scriptResult.malleability_warnings">{{ warning }}</li></ul>
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
                [(ngModel)]="descriptorInput" (ngModelChange)="invalidateResults()"
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
                <span class="badge" [ngClass]="descriptorResult.is_valid ? 'badge-success' : 'badge-danger'">
                  {{ descriptorResult.is_valid ? 'Valid Descriptor' : 'Invalid' }}
                </span>
              </div>
              <div class="col-sm-4 col-12">
                <div class="text-muted small">Type</div>
                <div class="fw-bold">{{ descriptorResult.script_type }}</div>
              </div>
              <div class="col-sm-4 col-12">
                <div class="text-muted small">Checksum</div>
                <div class="font-monospace small text-break">{{ descriptorResult.checksum }}</div>
              </div>
            </div>
            <p *ngIf="descriptorResult.derivation_note">{{ descriptorResult.derivation_note }}</p>
            <ul class="text-break"><li *ngFor="let sample of descriptorResult.derived_samples">
              Index {{ sample.index }}<span *ngIf="sample.branch !== undefined">, branch {{ sample.branch }}</span>:
              <code>{{ sample.address }}</code><br>Script: <code>{{ sample.script_pub_key }}</code>
            </li></ul>
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
                [(ngModel)]="psbtInput" (ngModelChange)="invalidateResults()"
                placeholder="Paste PSBT hex or base64..."
              ></textarea>
            </div>
            <button class="btn btn-primary" [disabled]="loading || !psbtInput.trim()" (click)="inspectPsbt()">Inspect PSBT</button>
          </div>
        </section>

        <!-- Initial Empty State -->
        <div *ngIf="!psbtResult && !loading" class="card p-4 text-center text-muted mb-4">
          Enter a partially signed Bitcoin transaction payload and click "Inspect PSBT" to inspect inputs, supplied signatures, and fees. Offline inspection cannot establish chain validity.
        </div>

        <section *ngIf="psbtResult && !loading" class="card mb-4">
          <div class="card-header">
            <h4 class="h5 mb-0">PSBT Inspection Result</h4>
          </div>
          <div class="card-body">
            <div class="row g-3">
              <div class="col-sm-3 col-6">
                <div class="text-muted small">Inputs</div>
                <div class="h5 mb-0">{{ psbtResult.input_count }}</div>
              </div>
              <div class="col-sm-3 col-6">
                <div class="text-muted small">Outputs</div>
                <div class="h5 mb-0">{{ psbtResult.output_count }}</div>
              </div>
              <div class="col-sm-3 col-6">
                <div class="text-muted small">Fee (sats)</div>
                <div class="h5 mb-0">{{ psbtResult.total_fee_sats === null ? 'Unknown' : (psbtResult.total_fee_sats | number) }}</div>
              </div>
              <div class="col-sm-3 col-6">
                <div class="text-muted small">Status</div>
                <span class="badge" [ngClass]="psbtResult.is_complete ? 'badge-success' : 'badge-warning'">
                  {{ psbtResult.is_complete ? 'Final scripts present' : 'Final scripts incomplete' }}
                </span>
              </div>
            </div>
            <p class="mt-3">{{ psbtResult.completion_scope }}</p>
            <p>Chain validation: Not evaluated</p>
            <ul><li *ngFor="let warning of psbtResult.warnings">{{ warning }}</li></ul>
          </div>
        </section>
      </div>
      <section *ngIf="activeTab === 'transaction'" class="card p-4 mb-4">
        <h2 class="h5">Verify a transaction input against owned previous outputs</h2>
        <label for="transaction-context-hex">Signed transaction hexadecimal</label>
        <textarea id="transaction-context-hex" class="form-control font-monospace" rows="5" [(ngModel)]="transactionInput" (ngModelChange)="invalidateResults()"></textarea>
        <label for="transaction-context-index" class="mt-3">Input index (zero-based)</label>
        <input id="transaction-context-index" type="number" min="0" max="31" class="form-control" [(ngModel)]="transactionIndex" (ngModelChange)="invalidateResults()">
        <button class="btn btn-primary mt-3" [disabled]="loading || !transactionInput.trim()" (click)="verifyTransaction()">Verify input script</button>
        <p class="mt-3">The owned Bitcoin source supplies every previous output. This executes the selected input, including its signature and script context. It does not sign, broadcast, or establish present spendability.</p>
        <div *ngIf="transactionResult"><h3 class="h6">{{transactionResult.results[0].script_valid ? 'Selected input script passed' : 'Selected input script failed'}}</h3><p>{{transactionResult.scope}}</p><p *ngIf="transactionResult.results[0].error" role="alert">{{transactionResult.results[0].error}}</p><pre>{{transactionResult | json}}</pre></div>
      </section>
      <section *ngIf="activeTab === 'simulate'" class="card p-4 mb-4">
        <h2 class="h5">Script execution and stack trace</h2>
        <label for="execution-script">Script hex</label>
        <input id="execution-script" class="form-control font-monospace" [(ngModel)]="scriptInput" (ngModelChange)="invalidateResults()">
        <label for="execution-witness" class="mt-3">Initial stack items (one hexadecimal item per line)</label>
        <textarea id="execution-witness" class="form-control font-monospace" [(ngModel)]="witnessInput" (ngModelChange)="invalidateResults()"></textarea>
        <button class="btn btn-primary mt-3" [disabled]="loading || !scriptInput.trim()" (click)="simulate()">Run stack trace</button>
        <p class="mt-3">Standalone legacy stack tracing. Signatures, timelocks and wrapped output programs require transaction context and are rejected by this form.</p>
        <div *ngIf="simulationResult" class="mt-3">
          <p>{{ simulationResult.scope }}</p>
          <p>{{ !simulationResult.completed ? 'Trace stopped at its resource limit' : simulationResult.script_succeeded ? 'Standalone script returned true' : 'Standalone script failed' }}</p>
          <p *ngIf="simulationResult.error" class="text-danger">{{ simulationResult.error }}</p>
        </div>
        <ol *ngIf="simulationResult"><li *ngFor="let step of simulationResult.steps"><code>{{ step.opcode }}</code>: [{{ step.stack_before.join(', ') }}] → [{{ step.stack_after.join(', ') }}] <span>{{ step.description }}</span></li></ol>
      </section>
      <section *ngIf="activeTab === 'miniscript'" class="card p-4 mb-4">
        <h2 class="h5">Compile Miniscript policy</h2>
        <label for="miniscript-policy">Policy using public keys</label>
        <textarea id="miniscript-policy" class="form-control font-monospace" [(ngModel)]="policyInput" (ngModelChange)="invalidateResults()"></textarea>
        <button class="btn btn-primary mt-3" [disabled]="loading || !policyInput.trim()" (click)="compile()">Compile policy</button>
        <div *ngIf="compileResult" class="text-break mt-3">
          <p>Miniscript: <code>{{ compileResult.miniscript }}</code></p>
          <p>Descriptor: <code>{{ compileResult.descriptor }}</code></p>
          <p>Script hex: <code>{{ compileResult.script_hex }}</code></p>
          <p>Maximum witness size: {{ compileResult.max_witness_size }} bytes</p>
          <p>Worst-case satisfaction weight: {{ compileResult.worst_case_satisfaction_weight }} WU</p>
          <p>{{ compileResult.scope }}</p>
        </div>
      </section>
      <section *ngIf="activeTab === 'taproot'" class="card p-4 mb-4">
        <h2 class="h5">Taproot descriptor and tree</h2>
        <label for="taproot-descriptor">Public tr(...) descriptor</label>
        <textarea id="taproot-descriptor" class="form-control font-monospace" [(ngModel)]="descriptorInput" (ngModelChange)="invalidateResults()"></textarea>
        <button class="btn btn-primary mt-3" [disabled]="loading || !descriptorInput.trim()" (click)="parseDescriptor()">Inspect Taproot descriptor</button>
        <p class="mt-3">Derived addresses come from Bitcoin Core. Tree commitments are computed independently and compared with the derived output.</p>
        <div *ngIf="descriptorResult" class="text-break"><p>{{ descriptorResult.script_type }} · {{ descriptorResult.is_valid ? 'Valid descriptor' : 'Invalid' }}</p>
          <p *ngFor="let sample of descriptorResult.derived_samples"><code>{{ sample.address }}</code><br><code>{{ sample.script_pub_key }}</code></p>
          <p *ngIf="descriptorResult.taproot_tree_note">{{ descriptorResult.taproot_tree_note }}</p>
          <section *ngFor="let tree of descriptorResult.taproot_trees" class="border rounded p-3 mt-3">
            <h3 class="h6">Branch {{ tree.branch }}, derivation index {{ tree.index }}</h3>
            <p>Internal key: <code>{{ tree.internal_key }}</code></p>
            <p>Output key: <code>{{ tree.output_key }}</code></p>
            <p>Merkle root: <code>{{ tree.merkle_root || 'Key path only; no script tree' }}</code></p>
            <ol><li *ngFor="let leaf of tree.leaves" class="mb-3">
              <p>Leaf depth {{ leaf.depth }} · {{ leaf.commitment_verified ? 'Control-block commitment verified' : 'Not verified' }}</p>
              <p>Miniscript: <code>{{ leaf.miniscript }}</code></p>
              <p>Leaf hash: <code>{{ leaf.leaf_hash }}</code></p>
              <details><summary>Script and control block</summary><p><code>{{ leaf.script_hex }}</code></p><p><code>{{ leaf.control_block }}</code></p></details>
            </li></ol>
            <p>{{ tree.scope }}</p>
          </section>
        </div>
      </section>
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
export class ScriptWorkbenchComponent implements OnInit, OnDestroy {
  activeTab = 'script';
  readonly extraTabs = [{ id: 'transaction', label: 'Transaction input' }, { id: 'simulate', label: 'Stack execution' }, { id: 'miniscript', label: 'Miniscript' }, { id: 'taproot', label: 'Taproot tree' }];
  scriptInput = '';
  descriptorInput = '';
  psbtInput = '';
  witnessInput = '';
  policyInput = '';
  transactionInput = '';
  transactionIndex = 0;
  transactionResult: any = null;
  loading = false;
  loadError: string | null = null;
  scriptResult: any = null;
  descriptorResult: any = null;
  psbtResult: any = null;
  simulationResult: any = null;
  compileResult: any = null;
  private revision = 0;
  private pending?: Subscription;
  private networkSubscription?: Subscription;

  constructor(@Inject(IntelligenceApiService) private api: IntelligenceApiService,
    @Inject(ChangeDetectorRef) private cdr: ChangeDetectorRef,
    @Inject(StateService) private state: StateService, @Inject(HttpClient) private http: HttpClient) {}

  ngOnInit(): void {
    this.networkSubscription = this.state.networkChanged$.subscribe(() => this.invalidateResults());
  }

  ngOnDestroy(): void {
    this.invalidateResults();
    this.networkSubscription?.unsubscribe();
  }

  invalidateResults(): void {
    this.revision++;
    this.pending?.unsubscribe();
    this.pending = undefined;
    this.scriptResult = this.descriptorResult = this.psbtResult = this.simulationResult = this.compileResult = this.transactionResult = null;
    this.loading = false;
    this.loadError = null;
    this.cdr.markForCheck();
  }

  selectTab(tab: string): void { this.invalidateResults(); this.activeTab = tab; }

  loadSampleScript(): void {
    this.invalidateResults();
    this.scriptInput = '0014751e76e8199196d454941c45d1b3a323f1433bd6';
  }
  loadSampleDescriptor(): void {
    this.invalidateResults();
    this.descriptorInput = 'wpkh(0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798)';
  }
  loadSamplePsbt(): void {
    this.invalidateResults();
    // Unsigned offline example with no UTXO data; its fee is unknown.
    this.psbtInput = 'cHNidP8BAD0CAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAD/////AQAAAAAAAAAAAWoAAAAAAAAA';
  }

  private request(source: Observable<any>, accept: (result: any) => void): void {
    this.invalidateResults();
    const revision = this.revision;
    this.loading = true;
    this.pending = source.subscribe({
      next: result => {
        if (revision !== this.revision) return;
        accept(result);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: error => {
        if (revision !== this.revision) return;
        this.invalidateResults();
        this.loadError = error?.error?.error || loadFailureMessage(classifyLoadFailure(error));
        this.cdr.markForCheck();
      },
    });
  }
  analyzeScript(): void {
    if (!this.scriptInput.trim()) { this.invalidateResults(); return; }
    this.request(this.api.analyzeScript$(this.scriptInput.trim()), result => this.scriptResult = result);
  }
  parseDescriptor(): void {
    if (!this.descriptorInput.trim()) { this.invalidateResults(); return; }
    if (this.activeTab === 'taproot' && !this.descriptorInput.trim().startsWith('tr(')) {
      this.invalidateResults(); this.loadError = 'Enter a public tr(...) descriptor.'; return;
    }
    this.request(this.api.parseDescriptor$(this.descriptorInput.trim()), result => this.descriptorResult = result);
  }
  inspectPsbt(): void {
    if (!this.psbtInput.trim()) { this.invalidateResults(); return; }
    this.request(this.api.analyzePsbt$(this.psbtInput.trim()), result => this.psbtResult = result);
  }
  verifyTransaction(): void {
    this.invalidateResults();
    const network=this.state.network || this.state.env.ROOT_NETWORK;
    const prefix=network===this.state.env.ROOT_NETWORK?'':'/'+network;
    this.request(this.http.post(prefix+'/api/v1/intelligence/workbench/transaction/verify',{transaction_hex:this.transactionInput.trim(),input_index:this.transactionIndex}),result=>{
      if(result?.source?.network!==network || !Array.isArray(result.results) || result.results.length!==1 || typeof result.results[0]?.script_valid!=='boolean' || result.whole_transaction_valid!==null || result.spendable_now!==null){this.loadError='Transaction verifier returned invalid or mis-scoped evidence.';return;}
      this.transactionResult=result;
    });
  }
  simulate(): void {
    if (!this.scriptInput.trim()) { this.invalidateResults(); return; }
    this.request(this.http.post('/api/v1/intelligence/workbench/script/simulate', {
      script_hex: this.scriptInput.trim(), witness: this.witnessInput.trim() ? this.witnessInput.trim().split(/\r?\n/).map(item => item.trim()) : [],
    }), result => this.simulationResult = result);
  }
  compile(): void {
    if (!this.policyInput.trim()) { this.invalidateResults(); return; }
    this.request(this.http.post('/api/v1/intelligence/workbench/miniscript/compile', { policy: this.policyInput.trim() }), result => this.compileResult = result);
  }
}
