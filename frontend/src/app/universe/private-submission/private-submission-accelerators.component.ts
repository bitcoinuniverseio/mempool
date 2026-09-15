import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { AcceleratorProvider, PrivateSubmissionApiService } from './private-submission.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-private-submission-accelerators',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Accelerator Providers</h1>
          <p class="text-muted mb-0">Signed provider directory: claimed pools and published fees.</p>
        </div>
        <a [routerLink]="'/mempool/submission' | relativeUrl" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>
      <div class="alert alert-warning" role="alert" *ngIf="loadError">
        {{ loadError }}
      </div>

      <div class="card bg-dark border-secondary mb-4" *ngIf="!loadError">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Available Acceleration Services</h5>
        </div>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Available Acceleration Services, scroll horizontally" i18n-aria-label>
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Networks</th>
                <th>Claimed partner pools</th>
                <th>Minimum fee</th>
                <th>Max vsize</th>
                <th>Health</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngIf="loaded && providers.length === 0">
                <td colspan="7" class="text-muted">The provider directory is empty.</td>
              </tr>
              <tr *ngFor="let p of providers">
                <td>
                  <a [routerLink]="['/mempool/accelerator' | relativeUrl, p.provider_id]" class="fw-bold text-info">
                    {{ p.name }}
                  </a>
                  <div class="small text-muted" *ngIf="isExpired(p)">directory entry expired {{ p.expires_at }}</div>
                </td>
                <td><span *ngFor="let network of p.supported_networks" class="badge bg-secondary me-1">{{ network }}</span></td>
                <td>
                  <span *ngFor="let pool of p.partner_mining_claims" class="badge bg-secondary me-1" title="claimed by the provider, not verified here">{{ pool }}</span>
                  <span *ngIf="!p.partner_mining_claims?.length" class="text-muted small">none claimed</span>
                </td>
                <td class="text-warning font-monospace">{{ p.minimum_fee_sats | number }} sats</td>
                <td class="font-monospace">{{ p.maximum_tx_vsize | number }} vB</td>
                <td><span class="badge" [ngClass]="healthClass(p.health_status)">{{ p.health_status | uppercase }}</span></td>
                <td>
                  <a [routerLink]="['/mempool/accelerator' | relativeUrl, p.provider_id]" class="btn btn-sm btn-outline-primary">View Details</a>
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
  public providers: AcceleratorProvider[] = [];
  public loaded = false;
  public loadError: string | null = null;

  constructor(private api: PrivateSubmissionApiService) {}

  public ngOnInit(): void {
    this.api.listAccelerators$().subscribe({
      // The contract is an envelope; a bare array or anything else is malformed.
      next: res => {
        if (!res || !Array.isArray(res.providers)) {
          this.providers = [];
          this.loaded = false;
          this.loadError = loadFailureMessage('malformed');
          return;
        }
        this.providers = res.providers.filter(provider => provider && typeof provider.provider_id === 'string');
        this.loaded = true;
        this.loadError = null;
      },
      error: err => {
        this.providers = [];
        this.loaded = false;
        this.loadError = err?.error?.error || loadFailureMessage(classifyLoadFailure(err));
      },
    });
  }

  public isExpired(provider: AcceleratorProvider): boolean {
    const expires = Date.parse(provider.expires_at);
    return Number.isFinite(expires) && expires < Date.now();
  }

  public healthClass(health: AcceleratorProvider['health_status']): string {
    if (health === 'online') { return 'bg-success'; }
    if (health === 'degraded') { return 'bg-warning text-dark'; }
    return 'bg-danger';
  }
}
