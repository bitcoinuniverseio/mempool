import { Subscription } from 'rxjs';
import { validProvider } from './submission-validation';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  classifyLoadFailure,
  loadFailureMessage,
} from '@app/shared/load-state';
import {
  AcceleratorDirectoryRef,
  AcceleratorProvider,
  PrivateSubmissionApiService,
} from './private-submission.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-private-submission-accelerators',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div
        class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom"
      >
        <div>
          <h1 class="h2 mb-1">Accelerator Providers</h1>
          <p class="text-muted mb-0">
            The owned provider directory is the trust root: identities, signing keys and their validity windows, and the terms each provider declares. Nothing here is probed or paid.
          </p>
        </div>
        <a
          [routerLink]="'/mempool/submission' | relativeUrl"
          class="btn btn-outline-secondary btn-sm"
          >Back to Overview</a
        >
      </div>
      <div class="alert alert-warning" role="alert" *ngIf="loadError">
        {{ loadError }}
      </div>

      <div class="card bg-dark border-secondary mb-4" *ngIf="!loadError">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Providers in the owned directory</h5>
          <div class="small text-muted" *ngIf="directory">
            {{ directory.source }}, revision {{ directory.revision }}, loaded {{ directory.loaded_at_utc }}<span *ngIf="network"> for {{ network }}</span>.
          </div>
        </div>
        <div
          class="table-responsive"
          tabindex="0"
          role="region"
          aria-label="Available Acceleration Services, scroll horizontally"
          i18n-aria-label
        >
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Networks</th>
                <th>Keys and validity</th>
                <th>Claimed partner pools</th>
                <th>Minimum fee</th>
                <th>Max vsize</th>
                <th>Payment methods</th>
                <th>Health</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngIf="loaded && providers.length === 0">
                <td colspan="9" class="text-muted">
                  The owned directory lists no provider for this network.
                </td>
              </tr>
              <tr *ngFor="let p of providers">
                <td>
                  <a
                    [routerLink]="[
                      '/mempool/accelerator' | relativeUrl,
                      p.provider_id,
                    ]"
                    class="fw-bold text-info"
                  >
                    {{ p.name }}
                  </a>
                  <div class="small text-muted font-monospace">{{ p.provider_id }}</div>
                  <div class="small text-muted" *ngIf="p.issuer">issuer {{ p.issuer }}<span *ngIf="p.protocol_version">, protocol {{ p.protocol_version }}</span></div>
                  <div class="small text-muted" *ngIf="isExpired(p)">
                    every directory key expired {{ p.expires_at }}
                  </div>
                </td>
                <td>
                  <span
                    *ngFor="let network of p.supported_networks"
                    class="badge bg-secondary me-1"
                    >{{ network }}</span
                  >
                </td>
                <td class="small">
                  <div *ngFor="let k of p.keys || []" class="font-monospace">
                    {{ k.kid }} ({{ k.algorithm }}): {{ k.validFrom }} to {{ k.validUntil ?? 'no end of validity' }}
                  </div>
                  <div *ngIf="!p.keys?.length" class="font-monospace text-break">identity key {{ p.identity_key }}</div>
                  <div class="text-muted">valid from {{ p.effective_from }} until {{ p.expires_at ?? 'no end of validity' }}</div>
                </td>
                <td>
                  <span
                    *ngFor="let pool of p.partner_mining_claims"
                    class="badge bg-secondary me-1"
                    title="claimed by the provider, not verified here"
                    >{{ pool }}</span
                  >
                  <span
                    *ngIf="!p.partner_mining_claims?.length"
                    class="text-muted small"
                    >none claimed</span
                  >
                </td>
                <td class="text-warning font-monospace">
                  {{ p.minimum_fee_sats | number }} sats
                </td>
                <td class="font-monospace">
                  {{ p.maximum_tx_vsize | number }} vB
                </td>
                <td class="small">
                  <span *ngFor="let m of p.payment_methods" class="badge bg-secondary me-1">{{ m }}</span>
                  <span *ngIf="!p.payment_methods?.length" class="text-muted">none declared</span>
                </td>
                <td>
                  <span
                    class="badge"
                    [ngClass]="
                      healthClass(isExpired(p) ? null : p.health_status)
                    "
                    >{{ healthLabel(p) }}</span
                  >
                </td>
                <td>
                  <a
                    [routerLink]="[
                      '/mempool/accelerator' | relativeUrl,
                      p.provider_id,
                    ]"
                    class="btn btn-sm btn-outline-primary"
                    >View Details</a
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class PrivateSubmissionAcceleratorsComponent
  implements OnInit, OnDestroy
{
  private request?: Subscription;
  private networkSub?: Subscription;
  ngOnDestroy(): void {
    this.request?.unsubscribe();
    this.networkSub?.unsubscribe();
  }
  public providers: AcceleratorProvider[] = [];
  public directory: AcceleratorDirectoryRef | null = null;
  public network: string | null = null;
  public loaded = false;
  public loadError: string | null = null;

  constructor(private api: PrivateSubmissionApiService) {}

  public ngOnInit(): void {
    this.networkSub = this.api.network$.subscribe(() => {
      this.request?.unsubscribe();
      this.providers = [];
      this.directory = null;
      this.network = null;
      this.loaded = false;
      this.loadError = null;
      this.request = this.api.listAccelerators$().subscribe({
        // The contract is an envelope; a bare array or anything else is malformed.
        next: (res) => {
          if (
            !res ||
            !Array.isArray(res.providers) ||
            !res.providers.every(validProvider)
          ) {
            this.providers = [];
            this.loaded = false;
            this.loadError = loadFailureMessage('malformed');
            return;
          }
          this.providers = res.providers;
          this.directory = res.directory ?? null;
          this.network = res.network ?? null;
          this.loaded = true;
          this.loadError = null;
        },
        error: (err) => {
          this.providers = [];
          this.loaded = false;
          this.loadError =
            err?.error?.error || loadFailureMessage(classifyLoadFailure(err));
        },
      });
    });
  }

  /** A null expires_at is a key with no end of validity, not an expired one. */
  public isExpired(provider: AcceleratorProvider): boolean {
    if (provider.expires_at === null || provider.expires_at === undefined) {
      return false;
    }
    const expires = Date.parse(provider.expires_at);
    return !Number.isFinite(expires) || expires <= Date.now();
  }

  public healthLabel(provider: AcceleratorProvider): string {
    if (this.isExpired(provider)) {
      return 'EXPIRED / HEALTH UNKNOWN';
    }
    return provider.health_status === 'unmeasured'
      ? 'Not measured: no endpoint is probed'
      : 'Reported: ' + provider.health_status;
  }

  public healthClass(
    health: AcceleratorProvider['health_status'] | null
  ): string {
    if (health === null || health === 'unmeasured') {
      return 'bg-secondary';
    }
    if (health === 'online') {
      return 'bg-secondary';
    }
    if (health === 'degraded') {
      return 'bg-warning text-dark';
    }
    return 'bg-danger';
  }
}
