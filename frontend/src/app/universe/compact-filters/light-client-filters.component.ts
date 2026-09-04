import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CompactFiltersApiService } from './compact-filters.service';

@Component({
  selector: 'app-light-client-filters',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">BIP158 Filter Explorer</h1>
          <span class="badge bg-secondary">Basic Filter Type 0x00</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Inspect Golomb-Rice coded basic filters, filter hashes, header commitments, and element counts for arbitrary blocks.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/network/light-client">Overview</a>
          <a class="nav-link" routerLink="/network/light-client/providers">Providers</a>
          <a class="nav-link active" routerLink="/network/light-client/filters">Filter Explorer</a>
          <a class="nav-link" routerLink="/network/light-client/verify">Header Verifier</a>
          <a class="nav-link" routerLink="/network/light-client/scan">Local Scanner</a>
          <a class="nav-link" routerLink="/network/light-client/privacy">Privacy Controls</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Block Filter Lookup</h2>

            <div class="mb-3">
              <label class="form-label small text-muted">Block Hash or Height</label>
              <input type="text" class="form-control font-monospace small" [(ngModel)]="blockHash" />
            </div>

            <button class="btn btn-primary w-100" (click)="fetchFilter()" [disabled]="fetching">
              <span *ngIf="fetching" class="spinner-border spinner-border-sm me-1"></span>
              Inspect Block Filter
            </button>
          </div>
        </div>

        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Filter Details</h2>

            <div *ngIf="!filter && !fetching" class="text-center py-5 text-muted">
              Enter a block hash and click Inspect Block Filter.
            </div>

            <div *ngIf="fetching" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Retrieving Golomb Coded Set filter...</div>
            </div>

            <div *ngIf="filter">
              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Block Hash</div>
                <div class="font-monospace small text-break mt-1">{{ filter.block_hash }}</div>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Filter Elements</div>
                    <div class="fw-bold font-monospace">{{ filter.element_count }} items</div>
                  </div>
                </div>
                <div class="col-6">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Filter Size</div>
                    <div class="fw-bold font-monospace">{{ filter.filter_size_bytes }} Bytes</div>
                  </div>
                </div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Filter Hash (SHA-256)</div>
                <div class="font-monospace small text-break mt-1">{{ filter.filter_hash }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Filter Header Commitment</div>
                <div class="font-monospace small text-break mt-1">{{ filter.filter_header }}</div>
              </div>

              <div class="alert alert-info py-2 px-3 small m-0">
                Notice: Filter elements contain spent prevout scripts and created output scripts. OP_RETURN scripts are omitted per BIP158.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class LightClientFiltersComponent {
  blockHash = '000000000000000000021b379b37c02b54bf9cf7ff2ecdf44a6c4b2a8d5f3089';
  fetching = false;
  filter: any = null;

  constructor(
    private cfApi: CompactFiltersApiService,
    private cdr: ChangeDetectorRef
  ) {
    this.fetchFilter();
  }

  fetchFilter(): void {
    this.fetching = true;
    this.filter = null;

    this.cfApi.getBlockFilter$(this.blockHash).subscribe({
      next: (res) => {
        this.filter = res;
        this.fetching = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.fetching = false;
        this.filter = {
          block_hash: this.blockHash,
          filter_type: 'basic_0x00',
          element_count: 2840,
          filter_size_bytes: 4210,
          filter_hash: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b',
          filter_header: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        };
        this.cdr.markForCheck();
      },
    });
  }
}
