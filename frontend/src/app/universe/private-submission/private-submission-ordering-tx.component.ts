import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { PrivateSubmissionApiService } from './private-submission.service';

@Component({
  selector: 'app-private-submission-ordering-tx',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4" *ngIf="ordering">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Transaction Ordering Proof: <span class="text-info font-monospace">{{ ordering.txid | slice:0:16 }}...</span></h1>
          <p class="text-muted mb-0 font-monospace">{{ ordering.txid }}</p>
        </div>
        <a routerLink="/intelligence/ordering" class="btn btn-outline-secondary btn-sm">Back to Findings</a>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Block Position</div>
            <div class="display-6 fw-bold text-danger my-1">#{{ ordering.position_in_block }}</div>
            <div class="small text-muted">Expected by Feerate: #{{ ordering.expected_position_by_feerate }}</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Discrepancy Score</div>
            <div class="display-6 fw-bold text-danger my-1">{{ ordering.ordering_discrepancy_score }} / 100</div>
            <div class="small text-muted">Statistically anomalous placement</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Declared Feerate</div>
            <div class="display-6 fw-bold text-warning my-1">{{ ordering.fee_rate_sat_vb }}</div>
            <div class="small text-muted">sat/vB</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Classification</div>
            <div class="h4 fw-bold text-info my-1">{{ ordering.classification }}</div>
            <div class="small text-muted">Miner: {{ ordering.miner_pool }}</div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Block Context</h5>
        </div>
        <div class="card-body">
          <dl class="row mb-0">
            <dt class="col-sm-3 text-muted">Block Height</dt>
            <dd class="col-sm-9 fw-bold">{{ ordering.block_height }}</dd>

            <dt class="col-sm-3 text-muted">Block Hash</dt>
            <dd class="col-sm-9 font-monospace">
              <a [routerLink]="['/intelligence/ordering/block', ordering.block_hash]" class="text-info">
                {{ ordering.block_hash }}
              </a>
            </dd>

            <dt class="col-sm-3 text-muted">Miner Pool</dt>
            <dd class="col-sm-9"><span class="badge bg-secondary">{{ ordering.miner_pool }}</span></dd>
          </dl>
        </div>
      </div>
    </div>
  `
})
export class PrivateSubmissionOrderingTxComponent implements OnInit {
  public ordering: any = null;

  constructor(
    private route: ActivatedRoute,
    private api: PrivateSubmissionApiService
  ) {}

  public ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const txid = params.get('txid') || '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678';
      this.api.getTxOrdering$(txid).subscribe(res => {
        this.ordering = res;
      });
    });
  }
}
