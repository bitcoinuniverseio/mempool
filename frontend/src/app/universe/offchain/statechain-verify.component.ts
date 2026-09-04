import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { OffchainApiService } from './offchain.service';

@Component({
  selector: 'app-statechain-verify',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Statechain Transfer Package Verifier</h1>
          <span class="badge bg-success">Local In-Browser Verification</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Verifies ownership handover, backup-transaction signature chains, decrementing locktime ordering, and server signature count agreement.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/offchain/utxo">Overview</a>
          <a class="nav-link" routerLink="/offchain/statechains/operators">Statechains</a>
          <a class="nav-link active" routerLink="/offchain/statechains/verify">Transfer Verifier</a>
          <a class="nav-link" routerLink="/offchain/coinswap">CoinSwap</a>
          <a class="nav-link" routerLink="/offchain/coinswap/inspect">CoinSwap Inspector</a>
          <a class="nav-link" routerLink="/offchain/recovery">Recovery Planner</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Transfer Package</h2>
            <p class="small text-muted mb-3">
              Paste the statechain transfer package JSON containing backup transactions and signature counts. Private keys or spend keys are rejected.
            </p>

            <div class="mb-3">
              <label class="form-label small text-muted">Transfer Package JSON</label>
              <textarea
                class="form-control font-monospace small"
                rows="14"
                [(ngModel)]="packageInput"
              ></textarea>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-primary" (click)="verifyPackage()" [disabled]="verifying">
                <span *ngIf="verifying" class="spinner-border spinner-border-sm me-1"></span>
                Verify Transfer Chain
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load Sample Package
              </button>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Verification Findings</h2>

            <div *ngIf="!report && !verifying" class="text-center py-5 text-muted">
              Submit a statechain transfer package to perform client-side chain analysis.
            </div>

            <div *ngIf="verifying" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Checking backup transactions, locktime sequence, and signature counts...</div>
            </div>

            <div *ngIf="report">
              <div class="alert" [ngClass]="report.valid ? 'alert-success' : 'alert-danger'">
                <div class="fw-bold">{{ report.valid ? 'Transfer Chain Cryptographically Valid' : 'Verification Failure' }}</div>
                <div class="small mt-1" *ngIf="report.valid">
                  Backup transactions form a strict decrementing locktime sequence matching operator signature counts.
                </div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Earliest Unilateral Exit Height</div>
                <div class="fs-4 fw-bold font-monospace">Block #{{ report.earliest_exit_height }}</div>
                <div class="small text-muted mt-1">Safety margin: {{ report.safety_blocks_remaining }} blocks</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Backup Transactions Verified</div>
                <div class="fs-5 fw-bold">{{ report.backup_transactions_count }} txs</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Server Signature Count Match</div>
                <div class="badge" [ngClass]="report.server_signature_count_match ? 'bg-success' : 'bg-danger'">
                  {{ report.server_signature_count_match ? 'MATCH CONFIRMED' : 'MISMATCH DETECTED' }}
                </div>
              </div>

              <div *ngIf="report.errors && report.errors.length > 0" class="mb-3">
                <div class="text-danger small fw-bold mb-1">Errors</div>
                <ul class="list-group list-group-flush">
                  <li *ngFor="let err of report.errors" class="list-group-item bg-transparent text-danger small p-1">
                    &bull; {{ err }}
                  </li>
                </ul>
              </div>

              <div class="alert alert-info py-2 px-3 small m-0">
                Notice: All verification occurred locally in your browser. No deposit UTXO details were transmitted to external servers.
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
export class StatechainVerifyComponent {
  packageInput = '';
  verifying = false;
  report: any = null;

  constructor(
    private offchainApi: OffchainApiService,
    private cdr: ChangeDetectorRef
  ) {
    this.loadSample();
  }

  loadSample(): void {
    this.packageInput = JSON.stringify(
      {
        statechain_id: 'sc-88902-alice',
        operator_id: 'sc-mercury-alpha',
        deposit_txid: 'd9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0',
        deposit_vout: 0,
        amount_sat: 10000000,
        backup_transactions: [
          { step: 1, locktime: 870000, fee_sat: 2000 },
          { step: 2, locktime: 869000, fee_sat: 2500 },
          { step: 3, locktime: 868000, fee_sat: 3000 },
        ],
        server_signature_count: 3,
      },
      null,
      2
    );
  }

  verifyPackage(): void {
    this.verifying = true;
    this.report = null;
    let pkg: any;
    try {
      pkg = JSON.parse(this.packageInput);
    } catch (e) {
      this.verifying = false;
      this.report = {
        valid: false,
        errors: ['Invalid JSON syntax in transfer package'],
      };
      this.cdr.markForCheck();
      return;
    }

    this.offchainApi.verifyStatechainTransfer$(pkg).subscribe({
      next: (res) => {
        this.report = res;
        this.verifying = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.verifying = false;
        this.report = {
          valid: false,
          errors: [err.message || 'Verification service error'],
        };
        this.cdr.markForCheck();
      },
    });
  }
}
