import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { PrivateSubmissionApiService } from './private-submission.service';

@Component({
  selector: 'app-private-submission-ordering-block',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4" *ngIf="blockOrdering">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Block {{ blockOrdering.height }} Transaction Ordering Audit</h1>
          <p class="text-muted mb-0 font-monospace">{{ blockOrdering.block_hash }}</p>
        </div>
        <a routerLink="/intelligence/ordering" class="btn btn-outline-secondary btn-sm">Back to Ordering Evidence</a>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Total Block Txs</div>
            <div class="display-6 fw-bold text-light my-1">{{ blockOrdering.total_txs | number }}</div>
            <div class="small text-muted">Miner: {{ blockOrdering.miner }}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Anomalous / Out-of-Order Txs</div>
            <div class="display-6 fw-bold text-warning my-1">{{ blockOrdering.out_of_order_tx_count }}</div>
            <div class="small text-muted">Deviations from knapsack template</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Est. Out-of-Band Revenue</div>
            <div class="display-6 fw-bold text-success my-1">{{ (blockOrdering.mev_or_acceleration_revenue_est_sats / 100000000) | number:'1.4-4' }} BTC</div>
            <div class="small text-muted">Unreported fee capture</div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Detected Anomalous Transactions</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Txid</th>
                <th>Actual Index</th>
                <th>Declared Fee Rate</th>
                <th>Block Median Fee</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let tx of blockOrdering.anomalous_txs">
                <td class="font-monospace text-info">
                  <a [routerLink]="['/intelligence/ordering/tx', tx.txid]">{{ tx.txid }}</a>
                </td>
                <td class="font-monospace fw-bold text-danger">#{{ tx.actual_index }}</td>
                <td class="text-warning">{{ tx.fee_rate }} sat/vB</td>
                <td class="text-muted">{{ tx.median_fee_rate }} sat/vB</td>
                <td>
                  <a [routerLink]="['/intelligence/ordering/tx', tx.txid]" class="btn btn-sm btn-outline-primary">View Evidence</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class PrivateSubmissionOrderingBlockComponent implements OnInit {
  public blockOrdering: any = null;

  constructor(
    private route: ActivatedRoute,
    private api: PrivateSubmissionApiService
  ) {}

  public ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const blockHash = params.get('blockHash') || '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3';
      this.api.getBlockOrdering$(blockHash).subscribe(res => {
        this.blockOrdering = res;
      });
    });
  }
}
