import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { CompactFiltersApiService, CompactFilterProvider } from './compact-filters.service';

@Component({
  selector: 'app-light-client-provider-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a routerLink="/network/light-client/providers" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Providers
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="provider">
          <div>
            <h1 class="m-0 font-monospace">{{ provider.address }}:{{ provider.port }}</h1>
            <div class="text-muted small font-monospace mt-1">{{ provider.subversion }}</div>
          </div>
          <span class="badge" [ngClass]="provider.actual_filter_serving_verified ? 'bg-success' : 'bg-warning text-dark'">
            {{ provider.actual_filter_serving_verified ? 'FILTER SERVING VERIFIED' : 'UNVERIFIED RESPONSES' }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading provider details...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && provider" class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border mb-4">
            <h2 class="h5 mb-3">Peer Connectivity & Service Flags</h2>
            <dl class="row mb-0">
              <dt class="col-sm-5 text-muted">IP Address</dt>
              <dd class="col-sm-7 font-monospace small">{{ provider.address }}</dd>

              <dt class="col-sm-5 text-muted">Port</dt>
              <dd class="col-sm-7 font-monospace small">{{ provider.port }}</dd>

              <dt class="col-sm-5 text-muted">Service Bits</dt>
              <dd class="col-sm-7 font-monospace small">{{ provider.services_bitmask }}</dd>

              <dt class="col-sm-5 text-muted">NODE_COMPACT_FILTERS</dt>
              <dd class="col-sm-7">
                <span class="badge" [ngClass]="provider.has_compact_filters_service_bit ? 'bg-success' : 'bg-secondary'">
                  {{ provider.has_compact_filters_service_bit ? 'PRESENT (BIT 6)' : 'ABSENT' }}
                </span>
              </dd>

              <dt class="col-sm-5 text-muted">Subversion</dt>
              <dd class="col-sm-7 font-monospace small">{{ provider.subversion }}</dd>

              <dt class="col-sm-5 text-muted">Latency</dt>
              <dd class="col-sm-7">{{ provider.latency_ms }} ms roundtrip</dd>

              <dt class="col-sm-5 text-muted">Last Probed</dt>
              <dd class="col-sm-7 small">{{ provider.last_probe_at }}</dd>
            </dl>
          </div>

          <div class="card p-4 bg-body-tertiary border">
            <h2 class="h5 mb-3">BIP157 Serving Integrity</h2>
            <div class="alert alert-info py-2 px-3 small mb-2">
              BIP157 Multi-Peer Trust Model:
            </div>
            <p class="small text-muted mb-0">
              Peers advertising the service bit are actively sampled for getcfilters, getcfheaders, and getcfcheckpt responses. The light-client verification center compares responses across multiple peers to detect and isolate malicious nodes serving forged or incomplete filter headers.
            </p>
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Filter Chain Status</h2>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Filter Tip Height</div>
              <div class="fs-4 fw-bold font-monospace">#{{ provider.filter_tip_height }}</div>
            </div>

            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Reachable</div>
              <div class="badge" [ngClass]="provider.is_reachable ? 'bg-success' : 'bg-danger'">
                {{ provider.is_reachable ? 'ONLINE' : 'UNREACHABLE' }}
              </div>
            </div>

            <div class="mt-auto pt-3 border-top">
              <a [routerLink]="['/network/light-client/verify']" class="btn btn-outline-primary w-100">
                Verify Filter Chain Against this Peer
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LightClientProviderDetailComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  provider: CompactFilterProvider | null = null;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private cfApi: CompactFiltersApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const providerId = this.route.snapshot.paramMap.get('providerId') || 'peer-192-0-2-1-8333';
    this.sub = this.cfApi.getProviderById$(providerId).subscribe({
      next: (data) => {
        this.provider = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load provider details';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
