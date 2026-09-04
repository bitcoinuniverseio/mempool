import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { LightningReliabilityApiService, LightningLspProvider } from './lightning-reliability.service';

@Component({
  selector: 'app-lightning-lsp',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Lightning Service Provider Directory</h1>
          <span class="badge bg-secondary" *ngIf="lsps.length > 0">
            {{ lsps.length }} Monitored LSPs
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Standardized LSPS protocol support (LSPS0 transport, LSPS1 channel orders, LSPS2 JIT liquidity, LSPS5 metrics) and capacity metrics.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/lightning/reliability">Reliability Overview</a>
          <a class="nav-link" routerLink="/lightning/liquidity">Liquidity Simulation</a>
          <a class="nav-link active" routerLink="/lightning/lsp">LSP Directory</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading LSP capability directory...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && lsps.length > 0" class="row g-4">
        <div *ngFor="let lsp of lsps" class="col-12 col-lg-6">
          <div class="card p-4 h-100 bg-body-tertiary border">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
              <div>
                <h2 class="h5 m-0">{{ lsp.name }}</h2>
                <code class="small text-muted text-break">{{ lsp.node_pubkey }}</code>
              </div>
              <span class="badge bg-success" *ngIf="lsp.compliance_verified">Standard Verified</span>
            </div>

            <div class="mb-3">
              <div class="text-muted small">Channel Capacity Allocation</div>
              <div class="h4 my-1 text-primary">{{ (lsp.active_channel_capacity_sats / 100000000).toFixed(2) }} BTC</div>
              <div class="small text-muted">{{ lsp.active_channel_capacity_sats | number }} sats deployed</div>
            </div>

            <div class="mb-3">
              <div class="text-muted small mb-1">Standard Specifications Supported</div>
              <div class="d-flex flex-wrap gap-1">
                <span class="badge" [ngClass]="lsp.lsps0_supported ? 'bg-primary' : 'bg-secondary'">LSPS0 (Transport)</span>
                <span class="badge" [ngClass]="lsp.lsps1_order_supported ? 'bg-success' : 'bg-secondary'">LSPS1 (Orders)</span>
                <span class="badge" [ngClass]="lsp.lsps2_jit_supported ? 'bg-info' : 'bg-secondary'">LSPS2 (JIT Inbound)</span>
                <span class="badge" [ngClass]="lsp.lsps5_metrics_supported ? 'bg-warning' : 'bg-secondary'">LSPS5 (Telemetry)</span>
              </div>
            </div>

            <div class="mt-auto pt-3 border-top d-flex justify-content-between align-items-center">
              <span class="small text-muted font-monospace" *ngIf="lsp.endpoint_url">{{ lsp.endpoint_url }}</span>
              <a [routerLink]="['/lightning/node', lsp.node_pubkey, 'reliability']" class="btn btn-sm btn-outline-primary ms-auto">
                Probe Reliability
              </a>
            </div>
          </div>
        </div>
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
export class LightningLspComponent implements OnInit, OnDestroy {
  lsps: LightningLspProvider[] = [];
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: LightningReliabilityApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getLspProviders$().subscribe({
        next: data => {
          this.lsps = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load LSP providers';
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
