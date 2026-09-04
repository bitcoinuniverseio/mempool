import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BootstrapApiService, AssumeUtxoSnapshot } from './bootstrap.service';

@Component({
  selector: 'app-bootstrap-snapshots',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">AssumeUTXO Snapshot Registry</h1>
          <span class="badge bg-secondary" *ngIf="snapshots.length > 0">
            {{ snapshots.length }} Snapshots
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Verified serialized UTXO set snapshots, SHA-256 integrity checksums, and Base UTXO hash commitments.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/node/bootstrap">Overview</a>
          <a class="nav-link active" routerLink="/node/bootstrap/snapshots">Snapshots</a>
          <a class="nav-link" routerLink="/node/bootstrap/verify">Integrity Verifier</a>
          <a class="nav-link" routerLink="/node/bootstrap/planner">Bootstrap Planner</a>
          <a class="nav-link" routerLink="/node/bootstrap/chainstates">Dual Chainstates</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading snapshot catalog...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && snapshots.length > 0" class="card p-4 bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Height</th>
                <th>Block Hash</th>
                <th>Coins Count</th>
                <th>Size</th>
                <th>UTXO Hash (MuHash)</th>
                <th>Core Version</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of snapshots">
                <td class="font-monospace fw-bold">#{{ s.height }}</td>
                <td class="font-monospace small text-truncate" style="max-width: 180px;">{{ s.block_hash }}</td>
                <td class="font-monospace">{{ s.coins_count | number }}</td>
                <td>{{ (s.file_size_bytes / 1073741824).toFixed(2) }} GB</td>
                <td class="font-monospace small text-truncate" style="max-width: 180px;">{{ s.base_utxo_hash }}</td>
                <td><span class="badge bg-secondary font-monospace">{{ s.release_version }}</span></td>
                <td>
                  <a [routerLink]="['/node/bootstrap/snapshot', s.height]" class="btn btn-sm btn-outline-primary">
                    Details
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
export class BootstrapSnapshotsComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  snapshots: AssumeUtxoSnapshot[] = [];
  private sub?: Subscription;

  constructor(
    private bootstrapApi: BootstrapApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.bootstrapApi.getSnapshots$().subscribe({
      next: (data) => {
        this.snapshots = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load snapshots';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
