import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PrivateSubmissionApiService, SubmissionOverview } from './private-submission.service';

@Component({
  selector: 'app-private-submission-overview',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Private Transaction Submission & Acceleration Center</h1>
          <p class="text-muted mb-0">Direct miner relays, out-of-band acceleration diagnostics, and block ordering verification.</p>
        </div>
        <div class="btn-group">
          <a routerLink="/mempool/private-broadcast" class="btn btn-primary btn-sm">Direct Miner Broadcast</a>
          <a routerLink="/mempool/accelerators" class="btn btn-outline-primary btn-sm">Accelerator Directory</a>
        </div>
      </div>

      <!-- Quick Nav Tabs -->
      <ul class="nav nav-tabs mb-4">
        <li class="nav-item">
          <a class="nav-link active" routerLink="/mempool/submission">Overview & Diagnose</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/mempool/private-broadcast">Private Broadcast</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/mempool/accelerators">Accelerators</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/mempool/receipts">Receipt Verification</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/intelligence/ordering">Ordering Evidence</a>
        </li>
      </ul>

      <!-- Metric Cards -->
      <div class="row g-3 mb-4" *ngIf="overview">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Private Submissions (24h)</div>
            <div class="display-6 fw-bold text-info my-1">{{ overview.total_private_submissions_24h }}</div>
            <div class="small text-muted">Bypassed public p2p mempools</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Accelerator Providers</div>
            <div class="display-6 fw-bold text-success my-1">{{ overview.active_accelerator_providers }}</div>
            <div class="small text-muted">&gt; 80% global hashpower reach</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Verified Receipts</div>
            <div class="display-6 fw-bold text-primary my-1">{{ overview.verified_receipts_count }}</div>
            <div class="small text-muted">Cryptographically audited</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Out-of-Band Inclusions (7d)</div>
            <div class="display-6 fw-bold text-warning my-1">{{ overview.detected_out_of_band_txs_7d }}</div>
            <div class="small text-muted">Ordering anomaly detections</div>
          </div>
        </div>
      </div>

      <!-- Transaction Diagnostic Box -->
      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Transaction Acceleration Diagnostic</h5>
        </div>
        <div class="card-body">
          <p class="text-muted small mb-3">
            Enter a stuck transaction ID or raw hex to diagnose feerate status, RBF/CPFP eligibility, and optimal acceleration strategy.
          </p>
          <div class="input-group mb-3">
            <input type="text" class="form-control bg-black text-light border-secondary font-monospace" placeholder="Enter txid or hex..." [(ngModel)]="inputTxid">
            <button class="btn btn-primary" (click)="diagnose()" [disabled]="diagnosing">
              {{ diagnosing ? 'Diagnosing...' : 'Diagnose Transaction' }}
            </button>
          </div>

          <div *ngIf="diagnosticResult" class="p-3 bg-black rounded border border-secondary mt-3">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <span class="badge bg-info">DIAGNOSIS COMPLETE</span>
              <span class="text-muted small">Est. Blocks: {{ diagnosticResult.estimated_delay_blocks }}</span>
            </div>
            <div class="row g-2 mb-2">
              <div class="col-md-4">Current Feerate: <strong>{{ diagnosticResult.fee_rate_sat_vb }} sat/vB</strong></div>
              <div class="col-md-4">Recommended Feerate: <strong>{{ diagnosticResult.recommended_fee_rate_sat_vb }} sat/vB</strong></div>
              <div class="col-md-4">RBF Signaling: <strong>{{ diagnosticResult.rbf_signaling ? 'YES' : 'NO' }}</strong></div>
            </div>
            <div class="alert alert-secondary bg-dark border-secondary mb-0 py-2">
              Recommended Strategy: <strong class="text-warning">{{ diagnosticResult.recommended_strategy }}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class PrivateSubmissionOverviewComponent implements OnInit {
  public overview: SubmissionOverview | null = null;
  public inputTxid = '';
  public diagnosing = false;
  public diagnosticResult: any = null;

  constructor(private api: PrivateSubmissionApiService) {}

  public ngOnInit(): void {
    this.api.getOverview$().subscribe(res => {
      this.overview = res;
    });
  }

  public diagnose(): void {
    if (!this.inputTxid) return;
    this.diagnosing = true;
    this.api.diagnose$(this.inputTxid).subscribe(res => {
      this.diagnosticResult = res;
      this.diagnosing = false;
    });
  }
}
