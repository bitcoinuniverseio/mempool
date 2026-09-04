import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PrivateSubmissionApiService } from './private-submission.service';

@Component({
  selector: 'app-private-submission-accelerators',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Transaction Accelerator Providers Directory</h1>
          <p class="text-muted mb-0">Verified miner acceleration gateways, supported hashrate coverage, and pricing models.</p>
        </div>
        <a routerLink="/mempool/submission" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Available Acceleration Services</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Provider Name</th>
                <th>Hashrate Reach</th>
                <th>Supported Pools</th>
                <th>Base Fee</th>
                <th>Success Rate</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let p of providers">
                <td>
                  <a [routerLink]="['/mempool/accelerator', p.provider_id]" class="fw-bold text-info">
                    {{ p.name }}
                  </a>
                </td>
                <td>
                  <div class="d-flex align-items-center">
                    <span class="me-2 fw-semibold">{{ p.hashrate_coverage_pct }}%</span>
                    <div class="progress flex-grow-1" style="height: 6px;">
                      <div class="progress-bar bg-info" [style.width.%]="p.hashrate_coverage_pct"></div>
                    </div>
                  </div>
                </td>
                <td>
                  <span *ngFor="let pool of p.supported_pools" class="badge bg-secondary me-1">{{ pool }}</span>
                </td>
                <td class="text-warning font-monospace">\${{ p.minimum_fee_usd | number:'1.2-2' }}</td>
                <td class="text-success fw-bold">{{ p.success_rate_pct }}%</td>
                <td><span class="badge bg-success">{{ p.status | uppercase }}</span></td>
                <td>
                  <a [routerLink]="['/mempool/accelerator', p.provider_id]" class="btn btn-sm btn-outline-primary">View Details</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class PrivateSubmissionAcceleratorsComponent implements OnInit {
  public providers: any[] = [];

  constructor(private api: PrivateSubmissionApiService) {}

  public ngOnInit(): void {
    this.api.listAccelerators$().subscribe(res => {
      this.providers = res;
    });
  }
}
