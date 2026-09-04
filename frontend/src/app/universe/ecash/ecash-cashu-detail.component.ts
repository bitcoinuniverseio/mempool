import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { EcashApiService, CashuMint } from './ecash.service';

@Component({
  selector: 'app-ecash-cashu-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="d-flex align-items-center gap-2 mb-2">
          <a routerLink="/ecash/cashu" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Cashu Mints
          </a>
          <span class="text-muted small">Cashu Observatory</span>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Cashu Mint Telemetry</h1>
          <span class="badge bg-success" *ngIf="mint">
            {{ mint.active_keysets_count }} Active Keysets
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading mint keysets and configuration...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && mint" class="content-body">
        <!-- Mint Summary Card -->
        <div class="card p-4 mb-4 bg-body-tertiary border">
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <div class="text-muted small">Mint Entity</div>
              <div class="h4 text-primary">{{ mint.name }}</div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-muted small">Mint Endpoint URL</div>
              <code class="h6 text-break">{{ mint.mint_url }}</code>
            </div>
          </div>
        </div>

        <!-- Keysets Table -->
        <div class="card p-4 bg-body-tertiary border mb-4">
          <h2 class="h5 mb-3">Cryptographic Keysets</h2>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Keyset ID</th>
                  <th>Unit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let k of mint.keysets">
                  <td><code class="fw-bold">{{ k.id }}</code></td>
                  <td>{{ k.unit }}</td>
                  <td>
                    <span class="badge" [ngClass]="k.active ? 'bg-success' : 'bg-secondary'">
                      {{ k.active ? 'Active (Issuing & Redeeming)' : 'Retired (Redeem Only)' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Supported NUTs -->
        <div class="card p-4 bg-body-tertiary border">
          <h2 class="h5 mb-3">Supported Notation of Unit (NUT) Specifications</h2>
          <div class="d-flex flex-wrap gap-2">
            <span *ngFor="let n of mint.nuts_supported" class="badge bg-secondary p-2">
              NUT-{{ n < 10 ? '0' + n : n }}
            </span>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class EcashCashuDetailComponent implements OnInit, OnDestroy {
  mint: CashuMint | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private api: EcashApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.route.paramMap.subscribe(params => {
        const mintId = params.get('mintId');
        if (mintId) {
          this.fetchMint(mintId);
        }
      })
    );
  }

  private fetchMint(mintId: string): void {
    this.loading = true;
    this.sub.add(
      this.api.getCashuMintById$(mintId).subscribe({
        next: data => {
          this.mint = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.error?.error || err?.message || 'Failed to load mint details';
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
