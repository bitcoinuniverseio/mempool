import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-policy-lab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Transaction Package, Policy, and Inclusion Lab</h1>
          <span class="badge badge-primary" *ngIf="nodeProfile">{{ nodeProfile.subversion }}</span>
        </div>
        <p class="subtitle">
          Inspect exact transaction packages with the selected owned node. Calibrated inclusion forecasts and independent consensus certification are unavailable.
        </p>
      </header>

      <section class="card input-section mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h3 class="h5 mb-0">Package Raw Hex Transactions</h3>
          <button class="btn btn-sm btn-outline-secondary" (click)="loadSample()">Load Sample Package</button>
        </div>
        <div class="card-body">
          <textarea
            class="form-control font-monospace"
            rows="5"
            [(ngModel)]="rawTransactionsInput" (ngModelChange)="invalidate()"
            placeholder="Paste raw transaction hexes (one per line or comma separated)..."
            aria-label="Raw transaction hex inputs"
          ></textarea>
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3">
            <span class="text-muted small">Raw transaction bytes are sent to this backend and its owned Bitcoin Core for a policy check. No broadcast.</span>
            <button class="btn btn-primary" [disabled]="loading || !rawTransactionsInput.trim()" (click)="evaluate()">
              {{ loading ? 'Evaluating...' : 'Run Policy & Inclusion Analysis' }}
            </button>
          </div>
        </div>
      </section>

      <!-- Loading State -->
      <div *ngIf="loading" class="card p-4 text-center mb-4" role="status">
        <div class="spinner-border text-primary mx-auto" role="status"></div>
        <p class="mt-2 text-muted mb-0">Evaluating transaction package...</p>
      </div>

      <!-- Initial Empty State -->
      <div *ngIf="!evaluationResult && !loading && !errorMessage" class="card p-4 text-center text-muted mb-4">
        <p class="mb-0">Enter one or more raw transaction hex strings or load a sample package to inspect relay rules, feerates, and inclusion forecasts.</p>
      </div>

      <!-- Error State -->
      <div *ngIf="errorMessage" class="alert alert-danger mb-4" role="alert">
        {{ errorMessage }}
      </div>

      <!-- Results Grid -->
      <div *ngIf="evaluationResult && !loading" class="results-grid">
        <!-- Summary Banner -->
        <div class="card mb-4" [ngClass]="evaluationResult.package_report?.overall_allowed === true ? 'border-success' : 'border-warning'">
          <div class="card-body d-flex justify-content-between align-items-center flex-wrap gap-3">
            <div>
              <span class="badge" [ngClass]="evaluationResult.package_report?.overall_allowed === true ? 'badge-success' : 'badge-danger'">
                {{ evaluationResult.package_report?.overall_allowed === true ? 'CORE POLICY ACCEPTED AT READ TIME' : evaluationResult.package_report?.overall_allowed === false ? 'CORE POLICY REJECTED' : 'POLICY UNKNOWN' }}
              </span>
              <h4 class="mt-2 mb-0">Package {{ evaluationResult.package_report?.package_id }}</h4>
            </div>
            <div class="metrics-row d-flex flex-wrap gap-4">
              <div>
                <div class="text-muted small">Package Feerate</div>
                <div class="h5 mb-0 text-primary">{{ evaluationResult.package_report?.package_feerate_sats_vb ?? 'Unknown' }} sat/vB</div>
              </div>
              <div>
                <div class="text-muted small">Total Fees</div>
                <div class="h5 mb-0">{{ evaluationResult.package_report?.total_fees_sats === null ? 'Unknown' : (evaluationResult.package_report?.total_fees_sats | number) }} sats</div>
              </div>
              <div>
                <div class="text-muted small">Virtual Size</div>
                <div class="h5 mb-0">{{ evaluationResult.package_report?.total_vsize | number }} vB</div>
              </div>
              <div>
                <div class="text-muted small">Members</div>
                <div class="h5 mb-0">{{ evaluationResult.package_report?.members?.length }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Explanations & Remediation -->
        <div *ngIf="evaluationResult.explanations?.length > 0" class="card mb-4 border-warning">
          <div class="card-header bg-warning-subtle">
            <h4 class="h5 mb-0">Policy Diagnostics & Remediation</h4>
          </div>
          <div class="card-body">
            <div *ngFor="let expl of evaluationResult.explanations" class="mb-3 pb-3 border-bottom">
              <div class="d-flex justify-content-between align-items-center">
                <span class="badge badge-outline-warning">{{ expl.reject_code }}</span>
                <span class="text-muted small">Scope: {{ expl.scope }}</span>
              </div>
              <p class="lead mt-2 mb-1">{{ expl.plain_language_reason }}</p>
              <p class="text-muted small mb-3">{{ expl.technical_details }}</p>

              <div *ngIf="expl.remediations?.length > 0" class="remediations-list">
                <h6 class="text-uppercase small text-muted">Available Remediation Options:</h6>
                <div *ngFor="let rem of expl.remediations" class="remediation-item p-2 rounded bg-dark-subtle mb-2">
                  <div class="d-flex justify-content-between">
                    <strong>{{ rem.title }}</strong>
                    <span *ngIf="rem.estimated_cost_sats" class="badge badge-secondary">~{{ rem.estimated_cost_sats }} sats</span>
                  </div>
                  <div class="small mt-1">{{ rem.description }}</div>
                  <div class="small text-muted mt-1"><em>Tradeoffs: {{ rem.tradeoffs }}</em></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div *ngIf="evaluationResult.forecast as forecast" class="card mb-4">
          <div class="card-header"><h4 class="h5">Inclusion evidence</h4></div>
          <div class="card-body">
            <p>{{ forecast.scope }}</p><p *ngIf="forecast.unavailable_reason">{{ forecast.unavailable_reason }}</p>
            <div class="row"><div class="col" *ngFor="let horizon of [1,2,3,6,12,24]"><strong>{{ horizon }} blocks</strong><p>Probability unknown</p></div></div>
            <p>Confidence interval unknown. No trained or calibrated model is available.</p>
            <p>Observed transactions: {{ forecast.observed_transactions ?? 'Unknown' }}; virtual bytes with a higher individual feerate: {{ forecast.observed_vsize_ahead ?? 'Unknown' }}.</p>
            <p>Nominal queue capacity: {{ forecast.queue_capacity_blocks ?? 'Unknown' }} blocks of 1,000,000 vB. This is not a confirmation estimate; miner policy, dependencies and future arrivals can change ordering.</p>
          </div>
        </div>
        <p class="small">{{ evaluationResult.package_report?.scope }}</p>
        <!-- Package Members Table -->
        <div class="card mb-4">
          <div class="card-header">
            <h4 class="h5 mb-0">Package Members</h4>
          </div>
          <div class="table-responsive" tabindex="0">
            <table class="table table-hover mb-0">
              <thead>
                <tr>
                  <th scope="col">Txid</th>
                  <th scope="col">Status</th>
                  <th scope="col">Virtual Size</th>
                  <th scope="col">Fee</th>
                  <th scope="col">Feerate</th>
                  <th scope="col">Consensus</th>
                  <th scope="col">Relay</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let member of evaluationResult.package_report?.members">
                  <td class="font-monospace small">{{ member.txid | slice:0:16 }}...</td>
                  <td>
                    <span class="badge" [ngClass]="member.allowed === true ? 'badge-success' : 'badge-danger'">
                      {{ member.allowed === true ? 'Accepted' : member.allowed === false ? 'Rejected' : 'Unknown' }}
                    </span>
                  </td>
                  <td>{{ member.vsize }} vB</td>
                  <td>{{ member.fee_sats === null ? 'Unknown' : (member.fee_sats | number) }} sats</td>
                  <td>{{ member.effective_feerate ?? 'Unknown' }} sat/vB</td>
                  <td>
                    <span class="badge" [ngClass]="member.consensus_valid === true ? 'badge-success' : 'badge-secondary'">
                      {{ member.consensus_valid === true ? 'Verified' : member.consensus_valid === false ? 'Invalid' : 'Not independently verified' }}
                    </span>
                  </td>
                  <td>
                    <span class="badge" [ngClass]="member.relay_valid === true ? 'badge-success' : 'badge-secondary'">
                      {{ member.relay_valid === true ? 'Core allowed at read time' : member.relay_valid === false ? 'Core rejected' : 'Unknown' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .intelligence-page {
      padding-top: 2rem;
      padding-bottom: 4rem;
    }
    .page-header {
      margin-bottom: 2rem;
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .font-monospace {
      font-family: var(--font-family-monospace, monospace);
    }
    .badge {
      display: inline-block;
      padding: 0.35em 0.65em;
      font-size: 0.75em;
      font-weight: 700;
      line-height: 1;
      text-align: center;
      white-space: nowrap;
      vertical-align: baseline;
      border-radius: 0.25rem;
    }
    .badge-primary { background-color: var(--bs-primary, #0d6efd); color: #fff; }
    .badge-success { background-color: var(--bs-success, #198754); color: #fff; }
    .badge-warning { background-color: var(--bs-warning, #ffc107); color: #000; }
    .badge-danger { background-color: var(--bs-danger, #dc3545); color: #fff; }
    .badge-secondary { background-color: var(--bs-secondary, #6c757d); color: #fff; }
    .badge-outline-warning { border: 1px solid var(--bs-warning, #ffc107); color: var(--bs-warning, #ffc107); }
    .bg-dark-subtle { background-color: var(--bs-dark-bg-subtle, rgba(255,255,255,0.05)); }
  `],
})
export class PolicyLabComponent implements OnInit, OnDestroy {
  rawTransactionsInput = ''; loading = false; errorMessage: string | null = null; evaluationResult: any = null; nodeProfile: any = null;
  private attempt = 0; private destroyed = false; private request?: Subscription; private profileRequest?: Subscription; private networkRequest?: Subscription;
  constructor(private api: IntelligenceApiService, private cdr: ChangeDetectorRef, private state: StateService) {}
  private get network(): string { return this.state.network || 'mainnet'; }
  ngOnInit(): void {
    this.loadProfile();
    this.networkRequest = this.state.networkChanged$?.subscribe(() => { this.invalidate(); this.nodeProfile = null; this.loadProfile(); });
  }
  private loadProfile(): void {
    this.profileRequest?.unsubscribe(); const network = this.network;
    this.profileRequest = this.api.getNodeProfiles$().subscribe({next: value => { if (!this.destroyed && this.network === network) this.nodeProfile = value?.profiles?.find((profile: any) => profile.network === network) ?? null; this.cdr.markForCheck(); },error:()=>{this.nodeProfile=null;this.cdr.markForCheck();}});
  }
  invalidate(): void { this.attempt++; this.request?.unsubscribe(); this.evaluationResult=null;this.errorMessage=null;this.loading=false;this.cdr.markForCheck(); }
  ngOnDestroy(): void { this.destroyed=true;this.attempt++;this.request?.unsubscribe();this.profileRequest?.unsubscribe();this.networkRequest?.unsubscribe(); }
  loadSample(): void { this.invalidate(); this.rawTransactionsInput='020000000101010101010101010101010101010101010101010101010101010101010101010000000000ffffffff012823000000000000015100000000';this.cdr.markForCheck(); }
  async evaluate(): Promise<void> {
    this.invalidate(); const source=this.rawTransactionsInput,network=this.network,attempt=this.attempt;
    const rawTxs=source.split(/[\n,]+/).map(value=>value.trim().toLowerCase()).filter(Boolean);
    if(!rawTxs.length||rawTxs.length>25||rawTxs.some(raw=>raw.length%2!==0||!/^[0-9a-f]+$/.test(raw))||rawTxs.reduce((n,raw)=>n+raw.length,0)>8000000){this.errorMessage='Supply 1 to 25 raw transactions within 4 MB.';return;}
    this.loading=true;this.cdr.markForCheck();
    try {
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rawTxs.join(':')));
      const expected=Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
      if(this.destroyed||attempt!==this.attempt||source!==this.rawTransactionsInput||network!==this.network)return;
      this.request=this.api.evaluatePackage$(rawTxs).subscribe({next:res=>{
        if(this.destroyed||attempt!==this.attempt||source!==this.rawTransactionsInput||network!==this.network)return;
        const report=res?.package_report;
        if(!report||report.input_hash!==expected||report.network!==network||!Array.isArray(report.members)||report.members.length!==rawTxs.length){this.errorMessage='Policy response does not match the submitted bytes and network.';this.evaluationResult=null;}
        else this.evaluationResult=res;
        this.loading=false;this.cdr.markForCheck();
      },error:err=>{if(this.destroyed||attempt!==this.attempt)return;this.evaluationResult=null;this.errorMessage=err?.error?.error||'Policy evidence unavailable';this.loading=false;this.cdr.markForCheck();}});
    } catch { if(attempt===this.attempt){this.loading=false;this.errorMessage='Unable to bind this request to its transaction bytes.';this.cdr.markForCheck();} }
  }
}
