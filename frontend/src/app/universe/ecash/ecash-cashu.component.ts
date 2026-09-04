import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { EcashApiService, CashuMint } from './ecash.service';

@Component({
  selector: 'app-ecash-cashu',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Cashu Mint Directory</h1>
          <span class="badge bg-secondary" *ngIf="mints.length > 0">
            {{ mints.length }} Active Mints
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Public endpoints, cryptographic keyset lifecycles, and NUT protocol specifications across the Cashu ecash ecosystem.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/ecash">Overview</a>
          <a class="nav-link active" routerLink="/ecash/cashu">Cashu Mints</a>
          <a class="nav-link" routerLink="/ecash/fedimint">Fedimint Federations</a>
          <a class="nav-link" routerLink="/ecash/inspect">Offline Token Inspector</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Cashu mints catalog...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && mints.length > 0" class="row g-4">
        <div *ngFor="let m of mints" class="col-12 col-lg-6">
          <div class="card p-4 h-100 bg-body-tertiary border">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
              <div>
                <h2 class="h5 m-0">{{ m.name }}</h2>
                <code class="small text-muted text-break">{{ m.mint_url }}</code>
              </div>
              <span class="badge bg-success">Online</span>
            </div>

            <div class="mb-3">
              <div class="text-muted small mb-1">Supported Notation of Unit (NUT) Specs</div>
              <div class="d-flex flex-wrap gap-1">
                <span *ngFor="let nut of m.nuts_supported" class="badge bg-secondary">
                  NUT-{{ nut < 10 ? '0' + nut : nut }}
                </span>
              </div>
            </div>

            <div class="mb-3">
              <div class="text-muted small mb-1">Active Keysets</div>
              <div class="d-flex flex-wrap gap-1">
                <span *ngFor="let k of m.keysets" class="badge" [ngClass]="k.active ? 'bg-primary' : 'bg-body-secondary text-muted'">
                  {{ k.id }} ({{ k.unit }}) {{ k.active ? 'Active' : 'Retired' }}
                </span>
              </div>
            </div>

            <div class="mt-auto pt-3 border-top d-flex justify-content-between align-items-center">
              <span class="small text-muted">Heartbeat: {{ m.last_heartbeat | date:'short' }}</span>
              <a [routerLink]="['/ecash/cashu', m.mint_id]" class="btn btn-sm btn-outline-primary">
                Inspect Mint Keysets
              </a>
            </div>
          </div>
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
export class EcashCashuComponent implements OnInit, OnDestroy {
  mints: CashuMint[] = [];
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: EcashApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getCashuMints$().subscribe({
        next: data => {
          this.mints = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load Cashu mints';
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
