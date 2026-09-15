import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { AcceleratorProvider, PrivateSubmissionApiService } from './private-submission.service';
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
            <div class="text-muted small text-uppercase">Health</div>
            <div class="h4 fw-bold my-1"><span class="badge" [ngClass]="healthClass(provider.health_status)">{{ provider.health_status | uppercase }}</span></div>
            <div class="small text-muted">From the provider's status endpoint</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Minimum Fee</div>
            <div class="display-6 fw-bold text-warning my-1">{{ provider.minimum_fee_sats | number }}</div>
            <div class="small text-muted">sats, as published by the provider</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Maximum Size</div>
            <div class="display-6 fw-bold text-info my-1">{{ provider.maximum_tx_vsize | number }}</div>
            <div class="small text-muted">vbytes per transaction</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Directory Entry</div>
            <div class="small my-1">From <span class="text-light">{{ provider.effective_from }}</span></div>
            <div class="small">Until <span class="text-light">{{ provider.expires_at }}</span></div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Integration Specifications</h5>
        </div>
        <div class="card-body">
          <dl class="row mb-0">
            <dt class="col-sm-3 text-muted">Status Endpoint</dt>
            <dd class="col-sm-9 font-monospace text-info text-break">{{ provider.status_endpoint }}</dd>

            <dt class="col-sm-3 text-muted">Identity Key</dt>
            <dd class="col-sm-9 font-monospace text-break">{{ provider.identity_key }}</dd>

            <dt class="col-sm-3 text-muted">Networks</dt>
            <dd class="col-sm-9"><span *ngFor="let network of provider.supported_networks" class="badge bg-secondary me-2">{{ network }}</span></dd>

            <dt class="col-sm-3 text-muted">Submission Modes</dt>
            <dd class="col-sm-9"><span *ngFor="let mode of provider.submission_modes" class="badge bg-secondary me-2">{{ mode }}</span></dd>

            <dt class="col-sm-3 text-muted">Payment Methods</dt>
            <dd class="col-sm-9"><span *ngFor="let method of provider.payment_methods" class="badge bg-secondary me-2">{{ method }}</span></dd>

            <dt class="col-sm-3 text-muted">Claimed Partner Pools</dt>
            <dd class="col-sm-9">
              <span *ngFor="let pool of provider.partner_mining_claims" class="badge bg-secondary me-2">{{ pool }}</span>
              <span class="small text-muted d-block mt-1">Claims made by the provider; this explorer does not verify pool partnerships.</span>
            </dd>
          </dl>
        </div>
      </div>
    </div>
  `
})
export class PrivateSubmissionAcceleratorDetailComponent implements OnInit {
  public provider: AcceleratorProvider | null = null;
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
          if (!res || typeof res.provider_id !== 'string') {
            this.provider = null;
            this.loadError = loadFailureMessage('malformed');
            return;
          }
          this.provider = res;
          this.loadError = null;
        },
        error: err => {
          this.provider = null;
          this.loadError = err?.error?.error || loadFailureMessage(classifyLoadFailure(err));
        },
      });
    });
  }

  public healthClass(health: AcceleratorProvider['health_status']): string {
    if (health === 'online') { return 'bg-success'; }
    if (health === 'degraded') { return 'bg-warning text-dark'; }
    return 'bg-danger';
  }
}
