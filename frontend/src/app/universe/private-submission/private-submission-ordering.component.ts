import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PrivateSubmissionApiService } from './private-submission.service';

@Component({
  selector: 'app-private-submission-ordering',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Transaction Ordering Evidence & MEV Detection</h1>
          <p class="text-muted mb-0">Empirical observation of block inclusion ordering discrepancies, fee-rate violations, and private flow evidence.</p>
        </div>
        <a routerLink="/mempool/submission" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Detected Ordering Discrepancies & Private Inclusions</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Txid</th>
                <th>Block Height</th>
                <th>Fee Rate</th>
                <th>Block Median</th>
                <th>Classification</th>
                <th>Miner Pool</th>
                <th>Severity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let f of findings">
                <td class="font-monospace text-info">
                  <a [routerLink]="['/intelligence/ordering/tx', f.txid]">{{ f.txid | slice:0:16 }}...</a>
                </td>
                <td class="fw-bold">{{ f.block_height }}</td>
                <td class="text-danger font-monospace">{{ f.fee_rate_sat_vb }} sat/vB</td>
                <td class="text-muted font-monospace">{{ f.block_median_fee_rate }} sat/vB</td>
                <td><span class="badge bg-warning text-dark">{{ f.inclusion_type }}</span></td>
                <td><span class="badge bg-secondary">{{ f.miner_pool }}</span></td>
                <td><span class="badge bg-danger">{{ f.severity | uppercase }}</span></td>
                <td>
                  <a [routerLink]="['/intelligence/ordering/tx', f.txid]" class="btn btn-sm btn-outline-info">Inspect Proof</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class PrivateSubmissionOrderingComponent implements OnInit {
  public findings: any[] = [];

  constructor(private api: PrivateSubmissionApiService) {}

  public ngOnInit(): void {
    this.api.listOrderingFindings$().subscribe(res => {
      this.findings = res;
    });
  }
}
