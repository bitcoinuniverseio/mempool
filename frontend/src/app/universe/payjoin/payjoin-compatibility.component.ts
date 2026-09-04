import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { PayjoinApiService, PayjoinCompatibilityEntry } from './payjoin.service';

@Component({
  selector: 'app-payjoin-compatibility',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Payjoin Ecosystem Compatibility Matrix</h1>
          <span class="badge bg-secondary" *ngIf="catalog.length > 0">
            {{ catalog.length }} Verified Implementations
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Cross-client compatibility tracking across senders, receivers, directory proxies, and hardware signers.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments/payjoin">Overview</a>
          <a class="nav-link" routerLink="/payments/payjoin/analyze">Proposal Analyzer</a>
          <a class="nav-link" routerLink="/payments/payjoin/directory">Directory Observatory</a>
          <a class="nav-link active" routerLink="/payments/payjoin/compatibility">Compatibility Matrix</a>
          <a class="nav-link" routerLink="/payments/payjoin/playground">Interactive Playground</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading ecosystem compatibility catalog...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && catalog.length > 0" class="card bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Software Application</th>
                <th>Role Capability</th>
                <th>BIP78 (v1 HTTP)</th>
                <th>BIP77 (v2 OHTTP)</th>
                <th>Deployment Status</th>
                <th>Implementation Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let item of catalog">
                <td class="fw-bold">{{ item.software }}</td>
                <td><span class="badge bg-secondary">{{ item.role | uppercase }}</span></td>
                <td>
                  <span class="badge" [ngClass]="item.bip78_v1_http ? 'bg-success' : 'bg-secondary'">
                    {{ item.bip78_v1_http ? 'Supported' : 'No' }}
                  </span>
                </td>
                <td>
                  <span class="badge" [ngClass]="item.bip77_v2_ohttp ? 'bg-success' : 'bg-secondary'">
                    {{ item.bip77_v2_ohttp ? 'Supported' : 'No' }}
                  </span>
                </td>
                <td><span class="badge bg-primary">{{ item.status | titlecase }}</span></td>
                <td class="small text-muted">{{ item.notes }}</td>
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
export class PayjoinCompatibilityComponent implements OnInit, OnDestroy {
  catalog: PayjoinCompatibilityEntry[] = [];
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: PayjoinApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getCompatibility$().subscribe({
        next: data => {
          this.catalog = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load compatibility';
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
