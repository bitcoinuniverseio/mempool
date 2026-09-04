import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SilentPaymentsApiService, SilentPaymentCoverageOverview } from './silent-payments.service';

@Component({
  selector: 'app-silent-payments-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Silent Payments Center</h1>
          <span class="badge bg-primary" *ngIf="overview">
            BIP352 Privacy Standard
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Non-interactive reusable stealth addresses for Bitcoin providing sender-receiver unlinkability and client-side balance discovery.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/payments/silent">Overview</a>
          <a class="nav-link" routerLink="/payments/silent/scan">In-Browser Scanner</a>
          <a class="nav-link" routerLink="/payments/silent/address">Address Validator</a>
          <a class="nav-link" routerLink="/payments/silent/psbt">PSBT Inspector</a>
          <a class="nav-link" routerLink="/payments/silent/coverage">Indexing Coverage</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Silent Payments indexing status...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="content-body">
        <!-- Top Metrics Cards -->
        <section class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Latest Indexed Height</div>
              <div class="h4 my-1 text-primary">{{ overview.latest_indexed_height | number }}</div>
              <div class="small text-muted">Synchronized with core node</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Indexed Block Manifests</div>
              <div class="h4 my-1 text-success">{{ overview.total_indexed_blocks | number }}</div>
              <div class="small text-muted">Scan bundles generated</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Candidate SP Outputs</div>
              <div class="h4 my-1 text-info">{{ overview.total_sp_outputs_detected | number }}</div>
              <div class="small text-muted">On-chain stealth outputs</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card p-3 h-100 bg-body-tertiary border">
              <div class="text-muted small">Ecosystem Wallets</div>
              <div class="h4 my-1 text-warning">{{ overview.ecosystem_adoption_count }}</div>
              <div class="small text-muted">Verified implementations</div>
            </div>
          </div>
        </section>

        <!-- Ecosystem Support Registry -->
        <section class="card p-4 bg-body-tertiary border mb-4">
          <h2 class="h5 mb-3">Verified Wallet & Ecosystem Support</h2>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Wallet / Software</th>
                  <th>Sending (BIP352)</th>
                  <th>Receiving (Scanning)</th>
                  <th>BIP375 Send PSBT</th>
                  <th>BIP376 Spend PSBT</th>
                  <th class="text-end">Verified Version</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let claim of overview.support_claims">
                  <td class="fw-bold">{{ claim.name }}</td>
                  <td>
                    <span class="badge" [ngClass]="claim.send_supported ? 'bg-success' : 'bg-secondary'">
                      {{ claim.send_supported ? 'Supported' : 'No' }}
                    </span>
                  </td>
                  <td>
                    <span class="badge" [ngClass]="claim.receive_supported ? 'bg-success' : 'bg-secondary'">
                      {{ claim.receive_supported ? 'Supported' : 'No' }}
                    </span>
                  </td>
                  <td>
                    <span class="badge" [ngClass]="claim.bip375_send_psbt ? 'bg-primary' : 'bg-secondary'">
                      {{ claim.bip375_send_psbt ? 'Supported' : 'No' }}
                    </span>
                  </td>
                  <td>
                    <span class="badge" [ngClass]="claim.bip376_spend_psbt ? 'bg-primary' : 'bg-secondary'">
                      {{ claim.bip376_spend_psbt ? 'Supported' : 'No' }}
                    </span>
                  </td>
                  <td class="text-end text-muted small"><code>{{ claim.verified_version }}</code></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .nav-link {
      color: inherit;
      padding: 0.4rem 0.8rem;
      border-radius: 0.375rem;
    }
    .nav-link.active {
      background-color: var(--bs-primary, #f7931a);
      color: #fff;
    }
  `],
})
export class SilentPaymentsOverviewComponent implements OnInit, OnDestroy {
  overview: SilentPaymentCoverageOverview | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: SilentPaymentsApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getCoverage$().subscribe({
        next: data => {
          this.overview = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load silent payments overview';
          this.loading = false;
          this.cd.markForCheck();
        },
      })
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
