import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
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
          <span class="badge badge-primary">Bitcoin Core 27.1 Policy</span>
        </div>
        <p class="subtitle">
          Evaluate transaction packages non-mutatively against Bitcoin Core relay policies, TRUC/v3 rules, and discrete-time inclusion forecasts.
        </p>
      </header>

      <section class="card input-section mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h3>Package Raw Hex Transactions</h3>
          <button class="btn btn-sm btn-outline-secondary" (click)="loadSample()">Load Sample Package</button>
        </div>
        <div class="card-body">
          <textarea
            class="form-control font-monospace"
            rows="5"
            [(ngModel)]="rawTransactionsInput"
            placeholder="Paste raw transaction hexes (one per line or comma separated)..."
          ></textarea>
          <div class="d-flex justify-content-between align-items-center mt-3">
            <span class="text-muted small">Evaluates against node consensus and mempool acceptance without broadcast.</span>
            <button class="btn btn-primary" [disabled]="loading || !rawTransactionsInput.trim()" (click)="evaluate()">
              {{ loading ? 'Evaluating...' : 'Run Policy & Inclusion Analysis' }}
            </button>
          </div>
        </div>
      </section>

      <div *ngIf="errorMessage" class="alert alert-danger mb-4">
        {{ errorMessage }}
      </div>

      <div *ngIf="evaluationResult" class="results-grid">
        <!-- Summary Banner -->
        <div class="card mb-4" [ngClass]="evaluationResult.package_report.overall_allowed ? 'border-success' : 'border-warning'">
          <div class="card-body d-flex justify-content-between align-items-center flex-wrap gap-3">
            <div>
              <span class="badge" [ngClass]="evaluationResult.package_report.overall_allowed ? 'badge-success' : 'badge-danger'">
                {{ evaluationResult.package_report.overall_allowed ? 'RELAY POLICY ACCEPTED' : 'RELAY POLICY REJECTED' }}
              </span>
              <h4 class="mt-2 mb-0">Package {{ evaluationResult.package_report.package_id }}</h4>
            </div>
            <div class="metrics-row d-flex gap-4">
              <div>
                <div class="text-muted small">Package Feerate</div>
                <div class="h5 mb-0 text-primary">{{ evaluationResult.package_report.package_feerate_sats_vb }} sat/vB</div>
              </div>
              <div>
                <div class="text-muted small">Total Fees</div>
                <div class="h5 mb-0">{{ evaluationResult.package_report.total_fees_sats | number }} sats</div>
              </div>
              <div>
                <div class="text-muted small">Virtual Size</div>
                <div class="h5 mb-0">{{ evaluationResult.package_report.total_vsize | number }} vB</div>
              </div>
              <div>
                <div class="text-muted small">Members</div>
                <div class="h5 mb-0">{{ evaluationResult.package_report.members.length }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Explanations & Remediation -->
        <div *ngIf="evaluationResult.explanations.length > 0" class="card mb-4 border-warning">
          <div class="card-header bg-warning-subtle">
            <h4 class="mb-0">Policy Diagnostics & Remediation</h4>
          </div>
          <div class="card-body">
            <div *ngFor="let expl of evaluationResult.explanations" class="mb-3 pb-3 border-bottom">
              <div class="d-flex justify-content-between align-items-center">
                <span class="badge badge-outline-warning">{{ expl.reject_code }}</span>
                <span class="text-muted small">Scope: {{ expl.scope }}</span>
              </div>
              <p class="lead mt-2 mb-1">{{ expl.plain_language_reason }}</p>
              <p class="text-muted small mb-3">{{ expl.technical_details }}</p>

              <div *ngIf="expl.remediations.length > 0" class="remediations-list">
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

        <!-- Inclusion Forecast Curves -->
        <div class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h4 class="mb-0">Discrete-Time Inclusion Forecast</h4>
            <span class="badge badge-secondary">{{ evaluationResult.forecast.model_version }}</span>
          </div>
          <div class="card-body">
            <p class="text-muted small mb-4">
              Calibrated survival probability estimates for inclusion across upcoming block intervals based on live mempool depth and feerate histograms.
            </p>
            <div class="row text-center g-3">
              <div class="col-md-2 col-4">
                <div class="p-3 rounded bg-dark-subtle">
                  <div class="small text-muted">Next Block</div>
                  <div class="h3 my-1" [ngClass]="evaluationResult.forecast.next_block > 0.7 ? 'text-success' : 'text-warning'">
                    {{ (evaluationResult.forecast.next_block * 100).toFixed(1) }}%
                  </div>
                  <div class="small text-muted font-monospace">[{{ (evaluationResult.forecast.confidence_interval[0] * 100).toFixed(0) }}-{{ (evaluationResult.forecast.confidence_interval[1] * 100).toFixed(0) }}%]</div>
                </div>
              </div>
              <div class="col-md-2 col-4">
                <div class="p-3 rounded bg-dark-subtle">
                  <div class="small text-muted">2 Blocks</div>
                  <div class="h3 my-1 text-info">{{ (evaluationResult.forecast.two_blocks * 100).toFixed(1) }}%</div>
                  <div class="small text-muted">~20 min</div>
                </div>
              </div>
              <div class="col-md-2 col-4">
                <div class="p-3 rounded bg-dark-subtle">
                  <div class="small text-muted">3 Blocks</div>
                  <div class="h3 my-1 text-info">{{ (evaluationResult.forecast.three_blocks * 100).toFixed(1) }}%</div>
                  <div class="small text-muted">~30 min</div>
                </div>
              </div>
              <div class="col-md-2 col-4">
                <div class="p-3 rounded bg-dark-subtle">
                  <div class="small text-muted">6 Blocks</div>
                  <div class="h3 my-1 text-primary">{{ (evaluationResult.forecast.six_blocks * 100).toFixed(1) }}%</div>
                  <div class="small text-muted">~1 hour</div>
                </div>
              </div>
              <div class="col-md-2 col-4">
                <div class="p-3 rounded bg-dark-subtle">
                  <div class="small text-muted">12 Blocks</div>
                  <div class="h3 my-1 text-primary">{{ (evaluationResult.forecast.twelve_blocks * 100).toFixed(1) }}%</div>
                  <div class="small text-muted">~2 hours</div>
                </div>
              </div>
              <div class="col-md-2 col-4">
                <div class="p-3 rounded bg-dark-subtle">
                  <div class="small text-muted">24 Blocks</div>
                  <div class="h3 my-1 text-success">{{ (evaluationResult.forecast.twenty_four_blocks * 100).toFixed(1) }}%</div>
                  <div class="small text-muted">~4 hours</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Package Members Table -->
        <div class="card mb-4">
          <div class="card-header">
            <h4 class="mb-0">Package Members</h4>
          </div>
          <div class="table-responsive">
            <table class="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Txid</th>
                  <th>Status</th>
                  <th>Virtual Size</th>
                  <th>Fee</th>
                  <th>Feerate</th>
                  <th>Consensus</th>
                  <th>Relay</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let member of evaluationResult.package_report.members">
                  <td class="font-monospace small">{{ member.txid | slice:0:16 }}...</td>
                  <td>
                    <span class="badge" [ngClass]="member.allowed ? 'badge-success' : 'badge-danger'">
                      {{ member.allowed ? 'Accepted' : 'Rejected' }}
                    </span>
                  </td>
                  <td>{{ member.vsize }} vB</td>
                  <td>{{ member.fee_sats | number }} sats</td>
                  <td>{{ member.effective_feerate }} sat/vB</td>
                  <td>
                    <span class="badge" [ngClass]="member.consensus_valid ? 'badge-success' : 'badge-danger'">
                      {{ member.consensus_valid ? 'Valid' : 'Invalid' }}
                    </span>
                  </td>
                  <td>
                    <span class="badge" [ngClass]="member.relay_valid ? 'badge-success' : 'badge-danger'">
                      {{ member.relay_valid ? 'Relay Safe' : 'Relay Disallowed' }}
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
    .badge-primary { background-color: #0d6efd; color: #fff; }
    .badge-success { background-color: #198754; color: #fff; }
    .badge-warning { background-color: #ffc107; color: #000; }
    .badge-danger { background-color: #dc3545; color: #fff; }
    .badge-secondary { background-color: #6c757d; color: #fff; }
    .badge-outline-warning { border: 1px solid #ffc107; color: #ffc107; }
  `],
})
export class PolicyLabComponent implements OnInit {
  rawTransactionsInput = '';
  loading = false;
  errorMessage: string | null = null;
  evaluationResult: any = null;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadSample();
    this.evaluate();
  }

  loadSample(): void {
    this.rawTransactionsInput =
      '02000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0100f2052a0100000043410496b538e853519c726a2c91e61ec11600ae1390813a627c66fb8be794bbe3e67020e17e572e632024f6655f4f4b822d159ced5da51657edffd7940761c7f536a5ac00000000';
  }

  evaluate(): void {
    const rawTxs = this.rawTransactionsInput
      .split(/[\n,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (rawTxs.length === 0) return;

    this.loading = true;
    this.errorMessage = null;
    this.cdr.markForCheck();

    this.api.evaluatePackage$(rawTxs).subscribe({
      next: (res) => {
        this.evaluationResult = res;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || err?.message || 'Policy evaluation request failed';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }
}
