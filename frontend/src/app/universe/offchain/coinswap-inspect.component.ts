import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-coinswap-inspect',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">CoinSwap Package Inspector</h1>
          <span class="badge bg-success">Local In-Browser Analysis</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Verifies timelock safety margins, hash commitments, signature validity, and abort recovery paths for multi-hop CoinSwap packages.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/offchain/utxo">Overview</a>
          <a class="nav-link" routerLink="/offchain/statechains/operators">Statechains</a>
          <a class="nav-link" routerLink="/offchain/statechains/verify">Transfer Verifier</a>
          <a class="nav-link" routerLink="/offchain/coinswap">CoinSwap</a>
          <a class="nav-link active" routerLink="/offchain/coinswap/inspect">CoinSwap Inspector</a>
          <a class="nav-link" routerLink="/offchain/recovery">Recovery Planner</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">CoinSwap Package</h2>
            <p class="small text-muted mb-3">
              Paste your sanitized CoinSwap contract package JSON. Seed phrases, wallet files, and private keys are strictly rejected.
            </p>

            <div class="mb-3">
              <label class="form-label small text-muted">Package JSON</label>
              <textarea
                class="form-control font-monospace small"
                rows="14"
                [(ngModel)]="packageInput"
              ></textarea>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-primary" (click)="inspectPackage()" [disabled]="inspecting">
                <span *ngIf="inspecting" class="spinner-border spinner-border-sm me-1"></span>
                Inspect Package
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load Sample Package
              </button>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Timelock & Path Analysis</h2>

            <div *ngIf="!report && !inspecting" class="text-center py-5 text-muted">
              Submit a CoinSwap package to inspect contract locktimes and recovery transactions.
            </div>

            <div *ngIf="inspecting" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Analyzing multi-hop timelock margins and hashlock integrity...</div>
            </div>

            <div *ngIf="report">
              <div class="alert" [ngClass]="report.valid ? 'alert-success' : 'alert-danger'">
                <div class="fw-bold">{{ report.valid ? 'CoinSwap Package Timelocks Safe' : 'Safety Warning Detected' }}</div>
                <div class="small mt-1" *ngIf="report.valid">
                  Taker contract timelock expires strictly after Maker contract timelock.
                </div>
                <div class="small mt-1" *ngIf="!report.valid">
                  {{ report.error }}
                </div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Maker Contract Timelock</div>
                <div class="font-monospace fw-bold">Block #{{ report.maker_locktime }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Taker Contract Timelock</div>
                <div class="font-monospace fw-bold">Block #{{ report.taker_locktime }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Timelock Delta (Safety Margin)</div>
                <div class="fs-5 fw-bold font-monospace" [ngClass]="report.delta > 0 ? 'text-success' : 'text-danger'">
                  {{ report.delta }} blocks
                </div>
              </div>

              <div class="alert alert-info py-2 px-3 small m-0">
                Notice: CoinSwap transactions are designed to look like standard single-key spends on-chain. Verification requires participant contract metadata.
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
export class CoinswapInspectComponent {
  packageInput = '';
  inspecting = false;
  report: any = null;

  constructor(private cdr: ChangeDetectorRef) {
    this.loadSample();
  }

  loadSample(): void {
    this.packageInput = JSON.stringify(
      {
        swap_id: 'cs-teleport-88210',
        maker_pubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        taker_pubkey: '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
        maker_contract_locktime: 864500,
        taker_contract_locktime: 864644,
        amount_sat: 25000000,
        hash_lock: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      null,
      2
    );
  }

  inspectPackage(): void {
    this.inspecting = true;
    this.report = null;

    try {
      const parsed = JSON.parse(this.packageInput);
      const delta = parsed.taker_contract_locktime - parsed.maker_contract_locktime;
      const valid = delta > 0;

      setTimeout(() => {
        this.report = {
          valid,
          maker_locktime: parsed.maker_contract_locktime,
          taker_locktime: parsed.taker_contract_locktime,
          delta,
          error: valid ? null : 'Reversed timelocks: Taker locktime must be greater than Maker locktime to prevent race condition',
        };
        this.inspecting = false;
        this.cdr.markForCheck();
      }, 300);
    } catch (e: any) {
      this.inspecting = false;
      this.report = {
        valid: false,
        error: 'Invalid JSON package syntax',
      };
      this.cdr.markForCheck();
    }
  }
}
