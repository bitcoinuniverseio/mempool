import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { CompactFiltersApiService, CompactFilterProvider } from './compact-filters.service';

@Component({
  selector: 'app-light-client-providers',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">BIP157 Filter Providers</h1>
          <span class="badge bg-secondary" *ngIf="providers.length > 0">
            {{ providers.length }} Peers
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Bitcoin network nodes advertising NODE_COMPACT_FILTERS (BIP157) capability and observed query performance.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/network/light-client">Overview</a>
          <a class="nav-link active" routerLink="/network/light-client/providers">Providers</a>
          <a class="nav-link" routerLink="/network/light-client/filters">Filter Explorer</a>
          <a class="nav-link" routerLink="/network/light-client/verify">Header Verifier</a>
          <a class="nav-link" routerLink="/network/light-client/scan">Local Scanner</a>
          <a class="nav-link" routerLink="/network/light-client/privacy">Privacy Controls</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading filter providers...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && providers.length > 0" class="card p-4 bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Peer Address</th>
                <th>Subversion</th>
                <th>Service Bits</th>
                <th>Filter Serving</th>
                <th>Tip Height</th>
                <th>Latency</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let p of providers">
                <td class="font-monospace fw-bold">{{ p.address }}:{{ p.port }}</td>
                <td class="font-monospace small">{{ p.subversion }}</td>
                <td><span class="badge bg-secondary font-monospace">{{ p.services_bitmask }}</span></td>
                <td>
                  <span class="badge" [ngClass]="p.actual_filter_serving_verified ? 'bg-success' : 'bg-warning text-dark'">
                    {{ p.actual_filter_serving_verified ? 'VERIFIED' : 'UNVERIFIED' }}
                  </span>
                </td>
                <td class="font-monospace">#{{ p.filter_tip_height }}</td>
                <td>{{ p.latency_ms }} ms</td>
                <td>
                  <a [routerLink]="['/network/light-client/provider', p.provider_id]" class="btn btn-sm btn-outline-primary">
                    Inspect
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class LightClientProvidersComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  providers: CompactFilterProvider[] = [];
  private sub?: Subscription;

  constructor(
    private cfApi: CompactFiltersApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.cfApi.getProviders$().subscribe({
      next: (data) => {
        this.providers = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load filter providers';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
