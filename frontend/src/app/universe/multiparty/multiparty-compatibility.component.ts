import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { MultipartyApiService } from './multiparty.service';

@Component({
  selector: 'app-multiparty-compatibility',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Hardware Vendor Compatibility Matrix</h1>
          <span class="badge bg-primary">Standards Compliance</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Cross-hardware compatibility verification matrix for MuSig2, BSMS, Wallet Policies, Miniscript, and Labels.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/tools/multiparty">Overview</a>
          <a class="nav-link" routerLink="/tools/multiparty/musig2">MuSig2 Coordinator</a>
          <a class="nav-link" routerLink="/tools/multiparty/bsms">BSMS Setup (BIP129)</a>
          <a class="nav-link" routerLink="/tools/multiparty/policies">Wallet Policies (BIP388)</a>
          <a class="nav-link" routerLink="/tools/multiparty/labels">Labels (BIP329)</a>
          <a class="nav-link active" routerLink="/tools/multiparty/compatibility">Hardware Matrix</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading hardware matrix...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading" class="card p-4 bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Hardware Device</th>
                <th>MuSig2 (BIP327)</th>
                <th>BSMS (BIP129)</th>
                <th>Policies (BIP388)</th>
                <th>Labels (BIP329)</th>
                <th>Air-Gapped QR</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="fw-bold">Coldcard Mk4 / Q</td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">BBQR / MicroSD</span></td>
              </tr>
              <tr>
                <td class="fw-bold">BitBox02</td>
                <td><span class="badge bg-warning text-dark">Beta</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-secondary">USB / MicroSD</span></td>
              </tr>
              <tr>
                <td class="fw-bold">Ledger Nano S+ / X / Stax</td>
                <td><span class="badge bg-secondary">Planned</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-secondary">USB / BLE</span></td>
              </tr>
              <tr>
                <td class="fw-bold">Blockstream Jade</td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-warning text-dark">Beta</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Animated QR</span></td>
              </tr>
              <tr>
                <td class="fw-bold">Krux DIY Signer</td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">Supported</span></td>
                <td><span class="badge bg-success">UR / BBQR</span></td>
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
export class MultipartyCompatibilityComponent implements OnInit, OnDestroy {
  loading = false;
  error: string | null = null;
  matrix: any = null;
  private sub?: Subscription;

  constructor(
    private multipartyApi: MultipartyApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.multipartyApi.getCompatibility$().subscribe({
      next: (data) => {
        this.matrix = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
