import { OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { verifyLocalFilter } from './local-filter-scan';
import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { CompactFiltersApiService } from './compact-filters.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-light-client-filters',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
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
          <a class="nav-link" [routerLink]="'/network/light-client' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/network/light-client/providers' | relativeUrl">Providers</a>
          <a class="nav-link active" [routerLink]="'/network/light-client/filters' | relativeUrl">Filter Explorer</a>
          <a class="nav-link" [routerLink]="'/network/light-client/verify' | relativeUrl">Header Verifier</a>
          <a class="nav-link" [routerLink]="'/network/light-client/scan' | relativeUrl">Local Scanner</a>
          <a class="nav-link" [routerLink]="'/network/light-client/privacy' | relativeUrl">Privacy Controls</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Block Filter Lookup</h2>
<label for="filter-network">Bitcoin network</label><select id="filter-network" [(ngModel)]="network" (ngModelChange)="edited()"><option value="main">Mainnet</option><option value="test">Testnet</option><option value="testnet4">Testnet4</option><option value="signet">Signet</option><option value="regtest">Regtest</option></select>

            <div class="mb-3">
              <label class="form-label small text-muted" for="light-client-filters-block">Block Hash or Height</label>
              <input type="text" class="form-control font-monospace small" id="light-client-filters-block" [(ngModel)]="blockHash" (ngModelChange)="edited()" />
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

            <div *ngIf="error" class="alert alert-warning" role="alert">
              {{ error }}
            </div>

            <div *ngIf="!filter && !fetching && !error" class="text-center py-5 text-muted">
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
                <div class="text-muted small">Filter Hash (double SHA-256)</div>
                <div class="font-monospace small text-break mt-1">{{ filter.filter_hash }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Filter Header Commitment</div>
                <div class="font-monospace small text-break mt-1">{{ filter.filter_header }}</div>
              </div>

              <div class="alert alert-info py-2 px-3 small m-0">
                BIP158 includes spent prevout scripts and created output scripts; output OP_RETURN scripts are omitted. Hash/header linkage and encoding are checked locally. Filter content is supplied by one owned index, not independently re-filtered or agreed by peers.
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
export class LightClientFiltersComponent implements OnDestroy {
 network='main';private request?:Subscription;
 edited():void{this.request?.unsubscribe();this.fetching=false;this.filter=null;this.error=null;}
 ngOnDestroy():void{this.edited();}
  blockHash = '0';
  fetching = false;
  filter: any = null;
  error: string | null = null;

  constructor(
    private cfApi: CompactFiltersApiService,
    private cdr: ChangeDetectorRef
  ) {
    this.fetchFilter();
  }

  fetchFilter(): void {
    this.edited(); this.fetching = true;
    this.filter = null;
    this.error = null;

    this.request=this.cfApi.getBlockFilter$(this.blockHash, this.network).subscribe({
      next: (res) => {
        try { if(res.network !== this.network) throw Error('Filter network mismatch.'); verifyLocalFilter(res); this.filter = res; } catch(error) { this.error = error instanceof Error ? error.message : 'Invalid filter'; }
        this.fetching = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.fetching = false;
        this.error = loadFailureMessage(classifyLoadFailure(err));
        this.cdr.markForCheck();
      },
    });
  }
}
