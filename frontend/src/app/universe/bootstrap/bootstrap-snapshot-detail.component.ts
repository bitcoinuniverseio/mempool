import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BootstrapApiService, AssumeUtxoSnapshot } from './bootstrap.service';

@Component({
  selector: 'app-bootstrap-snapshot-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a routerLink="/node/bootstrap/snapshots" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Snapshots
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="snapshot">
          <div>
            <h1 class="m-0">AssumeUTXO Snapshot #{{ snapshot.height }}</h1>
            <div class="text-muted small font-monospace mt-1 text-break">Block Hash: {{ snapshot.block_hash }}</div>
          </div>
          <span class="badge" [ngClass]="snapshot.status === 'pinned_core' ? 'bg-success' : 'bg-secondary'">
            {{ snapshot.status | uppercase }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading snapshot details...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && snapshot" class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border mb-4">
            <h2 class="h5 mb-3">Snapshot Commitments & Cryptographic Hashes</h2>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">UTXO Set Hash (MuHash)</div>
              <div class="font-monospace small text-break mt-1">{{ snapshot.base_utxo_hash }}</div>
            </div>

            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">File SHA-256 Checksum</div>
              <div class="font-monospace small text-break mt-1">{{ snapshot.sha256_checksum }}</div>
            </div>

            <div class="row g-2">
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Total UTXOs</div>
                  <div class="fw-bold font-monospace">{{ snapshot.coins_count | number }} coins</div>
                </div>
              </div>
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Archive File Size</div>
                  <div class="fw-bold font-monospace">{{ (snapshot.file_size_bytes / 1073741824).toFixed(2) }} GB</div>
                </div>
              </div>
            </div>
          </div>

          <div class="card p-4 bg-body-tertiary border">
            <h2 class="h5 mb-3">Bitcoin Core Command to Load</h2>
            <p class="small text-muted mb-2">
              To bootstrap a Bitcoin Core node using this snapshot, run via bitcoin-cli:
            </p>
            <div class="p-3 bg-body border rounded font-monospace small text-break user-select-all mb-3">
              bitcoin-cli loadtxoutset &quot;/path/to/utxo-{{ snapshot.height }}.dat&quot;
            </div>
            <p class="small text-muted mb-0">
              The node will verify the MuHash against its internal binary parameter, activate the snapshot chainstate immediately, and validate background blocks.
            </p>
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Provenance</h2>
            <dl class="row mb-0">
              <dt class="col-sm-5 text-muted">Core Release</dt>
              <dd class="col-sm-7 font-monospace small">{{ snapshot.release_version }}</dd>

              <dt class="col-sm-5 text-muted">Activation Block</dt>
              <dd class="col-sm-7 font-monospace small">#{{ snapshot.height }}</dd>

              <dt class="col-sm-5 text-muted">Verification Status</dt>
              <dd class="col-sm-7">
                <span class="text-success small fw-bold" *ngIf="snapshot.status === 'pinned_core'">
                  Hardcoded in Bitcoin Core source
                </span>
                <span class="text-muted small" *ngIf="snapshot.status !== 'pinned_core'">
                  Community attested
                </span>
              </dd>
            </dl>

            <div class="mt-auto pt-3 border-top">
              <a [routerLink]="['/node/bootstrap/verify']" class="btn btn-outline-primary w-100 mb-2">
                Verify File Checksum
              </a>
              <a [routerLink]="['/node/bootstrap/planner']" class="btn btn-outline-secondary w-100">
                Simulate Hardware IBD Timeline
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class BootstrapSnapshotDetailComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  snapshot: AssumeUtxoSnapshot | null = null;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private bootstrapApi: BootstrapApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const heightOrHash = this.route.snapshot.paramMap.get('heightOrHash') || '840000';
    this.sub = this.bootstrapApi.getSnapshotByHeightOrHash$(heightOrHash).subscribe({
      next: (data) => {
        this.snapshot = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load snapshot details';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
