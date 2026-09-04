import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { MultipartyApiService, MultipartyOverview } from './multiparty.service';

@Component({
  selector: 'app-multiparty-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">MuSig2 & Wallet Policy Interoperability Center</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            {{ overview.supported_protocols.length }} Core Protocols
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Cross-vendor coordination for MuSig2 (BIP327), BSMS setup (BIP129), BitBox02/Coldcard wallet policies (BIP388), and transaction label interoperability (BIP329).
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/tools/multiparty">Overview</a>
          <a class="nav-link" routerLink="/tools/multiparty/musig2">MuSig2 Coordinator</a>
          <a class="nav-link" routerLink="/tools/multiparty/bsms">BSMS Setup (BIP129)</a>
          <a class="nav-link" routerLink="/tools/multiparty/policies">Wallet Policies (BIP388)</a>
          <a class="nav-link" routerLink="/tools/multiparty/labels">Labels (BIP329)</a>
          <a class="nav-link" routerLink="/tools/multiparty/compatibility">Hardware Matrix</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading multiparty coordination protocols...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">MuSig2 (BIP327)</div>
            <div class="fs-4 fw-bold mt-1 text-success">Active</div>
            <div class="small text-muted mt-1">2-round Schnorr aggregation</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">BSMS (BIP129)</div>
            <div class="fs-4 fw-bold mt-1 text-primary">Supported</div>
            <div class="small text-muted mt-1">Multi-vendor descriptor setup</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Wallet Policies (BIP388)</div>
            <div class="fs-4 fw-bold mt-1">Compatible</div>
            <div class="small text-muted mt-1">Registerable hardware templates</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Labels (BIP329)</div>
            <div class="fs-4 fw-bold mt-1">Standardized</div>
            <div class="small text-muted mt-1">Encrypted label exchange format</div>
          </div>
        </div>

        <div class="col-12 col-lg-8">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Featured Interoperability Standards</h2>
            <div class="row g-3">
              <div *ngFor="let p of overview.featured_products" class="col-12 col-md-6">
                <div class="p-3 border rounded bg-body h-100 d-flex flex-column">
                  <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="fw-bold">{{ p.name }}</span>
                    <span class="badge bg-secondary font-monospace">{{ p.protocol }}</span>
                  </div>
                  <p class="small text-muted mb-3 flex-grow-1">{{ p.summary }}</p>
                  <div class="small text-muted font-monospace mb-2">
                    {{ p.bip_standards.join(', ') }}
                  </div>
                  <div class="d-flex flex-wrap gap-1">
                    <span class="badge bg-info text-dark small" *ngIf="p.hardware_compatibility.coldcard">Coldcard</span>
                    <span class="badge bg-info text-dark small" *ngIf="p.hardware_compatibility.bitbox02">BitBox02</span>
                    <span class="badge bg-info text-dark small" *ngIf="p.hardware_compatibility.ledger">Ledger</span>
                    <span class="badge bg-info text-dark small" *ngIf="p.hardware_compatibility.trezor">Trezor</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">MuSig2 Nonce Safety</h2>
            <div class="alert alert-danger py-2 px-3 small mb-3">
              Critical Cryptographic Warning:
            </div>
            <p class="small text-muted mb-3">
              In MuSig2, reusing a generated public nonce pair for signing two distinct transaction messages leaks the signer private key. Never reuse a session nonce.
            </p>
            <a routerLink="/tools/multiparty/musig2" class="btn btn-outline-primary btn-sm w-100">
              Open MuSig2 Coordinator &rarr;
            </a>
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
export class MultipartyOverviewComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  overview: MultipartyOverview | null = null;
  private sub?: Subscription;

  constructor(
    private multipartyApi: MultipartyApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.multipartyApi.getOverview$().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load multiparty overview';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
