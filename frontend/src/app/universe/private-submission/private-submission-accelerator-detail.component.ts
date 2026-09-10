import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { PrivateSubmissionApiService } from './private-submission.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-private-submission-accelerator-detail',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4" *ngIf="loadError">
      <div class="alert alert-warning" role="alert">{{ loadError }}</div>
    </div>
    <div class="container-xl py-4" *ngIf="provider">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Accelerator: <span class="text-info">{{ provider.name }}</span></h1>
          <p class="text-muted mb-0 font-monospace">Provider ID: {{ provider.provider_id }}</p>
        </div>
        <a [routerLink]="'/mempool/accelerators' | relativeUrl" class="btn btn-outline-secondary btn-sm">Back to Directory</a>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Hashrate Reach</div>
            <div class="display-6 fw-bold text-info my-1">{{ provider.hashrate_coverage_pct }}%</div>
            <div class="small text-muted">Across global block production</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Success Rate</div>
            <div class="display-6 fw-bold text-success my-1">{{ provider.success_rate_pct }}%</div>
            <div class="small text-muted">Next-3-blocks inclusion rate</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Base Fee</div>
            <div class="display-6 fw-bold text-warning my-1">\${{ provider.minimum_fee_usd }}</div>
            <div class="small text-muted">USD equivalent in BTC / sats</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Verification Format</div>
            <div class="h4 fw-bold text-primary my-1">{{ provider.verification_format }}</div>
            <div class="small text-muted">Cryptographic proof model</div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Integration Specifications</h5>
        </div>
        <div class="card-body">
          <dl class="row mb-0">
            <dt class="col-sm-3 text-muted">API Endpoint</dt>
            <dd class="col-sm-9 font-monospace text-info">{{ provider.api_endpoint }}</dd>

            <dt class="col-sm-3 text-muted">Supported Mining Pools</dt>
            <dd class="col-sm-9">
              <span *ngFor="let pool of provider.supported_pools" class="badge bg-secondary me-2">{{ pool }}</span>
            </dd>

            <dt class="col-sm-3 text-muted">Status</dt>
            <dd class="col-sm-9"><span class="badge bg-success">{{ provider.status | uppercase }}</span></dd>
          </dl>
        </div>
      </div>
    </div>
  `
})
export class PrivateSubmissionAcceleratorDetailComponent implements OnInit {
  public provider: any = null;
  public loadError: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: PrivateSubmissionApiService
  ) {}

  public ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const providerId = params.get('providerId');
      this.provider = null;
      if (!providerId) {
        // An earlier revision substituted a named provider here, so the page
        // read as that provider's record whatever address opened it.
        this.loadError = $localize`:@@submission.provider.missing:This address does not name a provider.`;
        return;
      }
      this.loadError = null;
      this.api.getAccelerator$(providerId).subscribe({
        next: res => {
          this.provider = res;
          this.loadError = null;
        },
        error: err => {
          this.provider = null;
          this.loadError = loadFailureMessage(classifyLoadFailure(err));
        },
      });
    });
  }
}
