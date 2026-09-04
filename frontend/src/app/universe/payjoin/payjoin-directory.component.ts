import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { PayjoinApiService, PayjoinDirectory } from './payjoin.service';

@Component({
  selector: 'app-payjoin-directory',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Payjoin Directory Observatory</h1>
          <span class="badge bg-secondary" *ngIf="directories.length > 0">
            {{ directories.length }} Relays Monitored
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Status, latency, and cryptographic public key tracking of decentralized Payjoin directory servers (BIP77 Oblivious HTTP).
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments/payjoin">Overview</a>
          <a class="nav-link" routerLink="/payments/payjoin/analyze">Proposal Analyzer</a>
          <a class="nav-link active" routerLink="/payments/payjoin/directory">Directory Observatory</a>
          <a class="nav-link" routerLink="/payments/payjoin/compatibility">Compatibility Matrix</a>
          <a class="nav-link" routerLink="/payments/payjoin/playground">Interactive Playground</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Querying directory infrastructure...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && directories.length > 0" class="card bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Directory Relay</th>
                <th>BIP77 OHTTP</th>
                <th>BIP78 HTTP</th>
                <th>OHTTP Key Hash</th>
                <th>Probe Latency</th>
                <th class="text-end">Last Health Check</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let dir of directories">
                <td><code class="fw-bold">{{ dir.url }}</code></td>
                <td>
                  <span class="badge" [ngClass]="dir.bip77_supported ? 'bg-success' : 'bg-secondary'">
                    {{ dir.bip77_supported ? 'v2 Enabled' : 'No' }}
                  </span>
                </td>
                <td>
                  <span class="badge" [ngClass]="dir.bip78_supported ? 'bg-primary' : 'bg-secondary'">
                    {{ dir.bip78_supported ? 'v1 Supported' : 'No' }}
                  </span>
                </td>
                <td><code class="small text-muted">{{ dir.ohttp_key_hash.slice(0, 16) }}...</code></td>
                <td>{{ dir.latency_ms }} ms</td>
                <td class="text-end text-muted small">{{ dir.last_tested_at }}</td>
              </tr>
            </tbody>
          </table>
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
export class PayjoinDirectoryComponent implements OnInit, OnDestroy {
  directories: PayjoinDirectory[] = [];
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: PayjoinApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getDirectories$().subscribe({
        next: data => {
          this.directories = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load directories';
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
