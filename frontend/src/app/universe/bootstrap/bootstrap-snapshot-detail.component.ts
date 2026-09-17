import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription, combineLatest } from 'rxjs';
import { BootstrapApiService, AssumeUtxoSnapshot } from './bootstrap.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-bootstrap-snapshot-detail',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a [routerLink]="'/node/bootstrap/snapshots' | relativeUrl" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Snapshots
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="snapshot">
          <div>
            <h1 class="m-0">AssumeUTXO Snapshot #{{ snapshot.height }}</h1>
            <div class="text-muted small font-monospace mt-1 text-break">Block Hash: {{ snapshot.block_hash }}</div>
          </div>
          <span class="badge" [ngClass]="snapshot.status === 'pinned_core' ? 'bg-success' : snapshot.status === 'invalid' ? 'bg-danger' : 'bg-secondary'">
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
              <div class="text-muted small">Pinned UTXO commitment (hash_serialized_3, operator-typed from Core chainparams)</div>
              <div class="font-monospace small text-break mt-1">{{ snapshot.base_utxo_hash ?? 'No commitment is pinned for this snapshot and Core version.' }}</div>
            </div>

            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">File SHA-256 (from the signed manifest)</div>
              <div class="font-monospace small text-break mt-1">{{ snapshot.sha256_checksum }}</div>
            </div>

            <div class="row g-2">
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Pinned coin count</div>
                  <div class="fw-bold font-monospace">{{ snapshot.coins_count === null ? 'not pinned' : (snapshot.coins_count | number) + ' coins' }}</div>
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
              bitcoin-cli -chain={{ bootstrapNetwork }} loadtxoutset &quot;/path/to/utxo-{{ snapshot.height }}.dat&quot;
            </div>
            <p class="small text-muted mb-0">
              Core checks its pinned serialized UTXO commitment before activating a supported snapshot. This page has not tested loading this file.
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

              <dt class="col-sm-5 text-muted">Producer</dt>
              <dd class="col-sm-7 font-monospace small">{{ snapshot.producer_id }}</dd>

              <dt class="col-sm-5 text-muted">Pinned commitment</dt>
              <dd class="col-sm-7 small">{{ snapshot.pinned_commitment ? 'pinned for Core ' + snapshot.release_version : 'none pinned' }}</dd>

              <dt class="col-sm-5 text-muted">Verification Status</dt>
              <dd class="col-sm-7">
                <span class="text-success small fw-bold" *ngIf="snapshot.status === 'pinned_core'">
                  A verification run over the bytes reached valid
                </span>
                <span class="text-danger small fw-bold" *ngIf="snapshot.status === 'invalid'">
                  The latest verification run over the bytes failed
                </span>
                <span class="text-muted small" *ngIf="snapshot.status === 'pending' || snapshot.status === 'verifying'">
                  A verification run is {{ snapshot.status }}
                </span>
                <span class="text-muted small" *ngIf="snapshot.status === 'unverified'">
                  No verification run over the bytes has reached valid
                </span>
                <span class="text-muted small" *ngIf="snapshot.status === 'unavailable'">
                  The verification store is unavailable; no run state can be read
                </span>
                <div class="small text-muted font-monospace" *ngIf="snapshot.latest_verification_id">latest run {{ snapshot.latest_verification_id }}: {{ snapshot.latest_verification_state }}</div>
              </dd>

              <dt class="col-sm-5 text-muted">Download</dt>
              <dd class="col-sm-7 small text-break">
                <a *ngIf="snapshot.download_url" [href]="snapshot.download_url" rel="noopener">{{ snapshot.download_url }}</a>
                <span *ngIf="!snapshot.download_url" class="text-muted">Local source; not served over https.</span>
              </dd>
            </dl>

            <div class="mt-auto pt-3 border-top">
              <a [href]="manifestUrl" target="_blank" rel="noopener" class="btn btn-outline-secondary w-100 mb-2">
                Signed manifest (JSON)
              </a>
              <a [routerLink]="['/node/bootstrap/verify' | relativeUrl]" class="btn btn-outline-primary w-100 mb-2">
                Verify the snapshot bytes
              </a>
              <a [routerLink]="['/node/bootstrap/planner' | relativeUrl]" class="btn btn-outline-secondary w-100">
                Plan a load on the owned node
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class BootstrapSnapshotDetailComponent implements OnInit, OnDestroy {
  get bootstrapNetwork(): string {const n=this.bootstrapApi.network;return n==='mainnet'?'main':n==='testnet'?'test':n==='testnet4'?'testnet4':n;}
  get manifestUrl(): string {return this.snapshot ? this.bootstrapApi.snapshotManifestUrl(this.snapshot.snapshot_id) : '';}
  loading = true;
  error: string | null = null;
  snapshot: AssumeUtxoSnapshot | null = null;
  private sub?: Subscription;
  private request?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private bootstrapApi: BootstrapApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = combineLatest([this.bootstrapApi.networkChanged$,this.route.paramMap]).subscribe(() => {
      this.request?.unsubscribe();this.snapshot=null;this.error=null;this.loading=true;this.cdr.markForCheck();
      const reference = this.route.snapshot.paramMap.get('heightOrHash') || '';
      this.request = this.bootstrapApi.getSnapshotByHeightOrHash$(reference).subscribe({
        next: data => {if (!(data && (data as any).network === this.bootstrapApi.network && (String(data.height) === reference || data.block_hash === reference))) {this.error='Snapshot catalogue response is not bound to this network and reference.';} else {this.snapshot=data;}this.loading=false;this.cdr.markForCheck();},
        error: err => {this.error=err?.error?.error || err?.message || 'Snapshot source unavailable';this.loading=false;this.cdr.markForCheck();}
      });
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.request?.unsubscribe();
  }
}
