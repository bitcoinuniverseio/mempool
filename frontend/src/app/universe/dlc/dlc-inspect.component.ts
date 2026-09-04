import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DlcApiService } from './dlc.service';

@Component({
  selector: 'app-dlc-inspect',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">DLC Contract Inspector</h1>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Browser-side private verification of DLC offer, accept, and sign messages, funding allocations, and CET payout curves.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/contracts/dlc">Overview</a>
          <a class="nav-link" routerLink="/contracts/dlc/oracles">Oracles</a>
          <a class="nav-link" routerLink="/contracts/dlc/events">Events</a>
          <a class="nav-link active" routerLink="/contracts/dlc/inspect">Contract Inspector</a>
          <a class="nav-link" routerLink="/contracts/dlc/simulate">Regtest Simulator</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Submit Contract Package</h2>
            <p class="small text-muted mb-3">
              Paste a JSON DLC contract package or TLV hex to verify party balances, fee allocations, adaptor signatures, and timelocks locally.
            </p>

            <div class="mb-3">
              <label class="form-label small text-muted">Contract Package JSON</label>
              <textarea
                class="form-control font-monospace small"
                rows="12"
                [(ngModel)]="packageInput"
                placeholder="{ &quot;contract_info&quot;: { ... } }"
              ></textarea>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-primary" (click)="verifyPackage()" [disabled]="verifying">
                <span *ngIf="verifying" class="spinner-border spinner-border-sm me-1"></span>
                Verify Contract Package
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load Sample Package
              </button>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Verification Report</h2>

            <div *ngIf="!report && !verifying" class="text-center py-5 text-muted">
              Paste a package and click Verify to inspect contract terms.
            </div>

            <div *ngIf="verifying" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Verifying cryptographic parameters and balance conservation...</div>
            </div>

            <div *ngIf="report">
              <div class="alert" [ngClass]="report.valid ? 'alert-success' : 'alert-danger'">
                <div class="fw-bold">{{ report.valid ? 'Contract Package Valid' : 'Verification Errors Detected' }}</div>
                <div class="small mt-1" *ngIf="report.valid">All collateral, payout curves, and adaptor signatures verified.</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Total Collateral</div>
                <div class="fs-5 fw-bold">{{ report.total_collateral_sat | number }} sat</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">CET Count</div>
                <div class="fs-5 fw-bold">{{ report.cet_count }} Contract Execution Transactions</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Refund Locktime</div>
                <div class="font-monospace small">Block height / Epoch: {{ report.refund_locktime }}</div>
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
                Data was processed strictly in your local session. No private keys or contract terms were recorded.
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
export class DlcInspectComponent {
  packageInput = '';
  verifying = false;
  report: any = null;

  constructor(private dlcApi: DlcApiService, private cdr: ChangeDetectorRef) {}

  loadSample(): void {
    this.packageInput = JSON.stringify(
      {
        contract_id: 'c-88029-sample',
        offer_collateral_sat: 10000000,
        accept_collateral_sat: 10000000,
        total_collateral_sat: 20000000,
        refund_locktime: 865000,
        cet_count: 64,
        oracles: ['oracle-kormir-rates'],
        event_id: 'event-btc-usd-2026-q4',
      },
      null,
      2
    );
    this.cdr.markForCheck();
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
        total_collateral_sat: 0,
        cet_count: 0,
        refund_locktime: 0,
        errors: ['Invalid JSON format in contract package input'],
      };
      this.cdr.markForCheck();
      return;
    }

    this.dlcApi.verifyContractPackage$(pkg).subscribe({
      next: (res) => {
        this.report = res;
        this.verifying = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.verifying = false;
        this.report = {
          valid: false,
          total_collateral_sat: 0,
          cet_count: 0,
          refund_locktime: 0,
          errors: [err.message || 'Verification service failure'],
        };
        this.cdr.markForCheck();
      },
    });
  }
}
