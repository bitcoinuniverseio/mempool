import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, distinctUntilChanged, startWith } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { sha256 } from '@scure/btc-signer/utils.js';
import { looksLikeSecret } from '../workbench/psbt-inspect';
import { DlcApiService } from './dlc.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-dlc-inspect',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">DLC Contract Inspector</h1>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Check declared collateral and payout arithmetic. Public contract JSON is sent to this explorer backend; cryptographic contract verification is not established.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/contracts/dlc' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/contracts/dlc/oracles' | relativeUrl">Oracles</a>
          <a class="nav-link" [routerLink]="'/contracts/dlc/events' | relativeUrl">Events</a>
          <a class="nav-link active" [routerLink]="'/contracts/dlc/inspect' | relativeUrl">Contract Inspector</a>
          <a class="nav-link" [routerLink]="'/contracts/dlc/simulate' | relativeUrl">Regtest Simulator</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Submit Contract Package</h2>
            <p class="small text-muted mb-3">
              Paste public JSON with parties, CET payouts and refund payouts. No private keys are needed. Adaptor signatures, funding UTXOs, transaction scripts and timelock maturity are outside these arithmetic checks.
            </p>

            <div class="mb-3">
              <label class="form-label small text-muted">Contract Package JSON</label>
              <textarea
                class="form-control font-monospace small"
                rows="12"
                [(ngModel)]="packageInput" (ngModelChange)="edited()" maxlength="500000"
                placeholder="{ &quot;contract_info&quot;: { ... } }"
              ></textarea>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-primary" (click)="verifyPackage()" [disabled]="verifying">
                <span *ngIf="verifying" class="spinner-border spinner-border-sm me-1"></span>
                Check Package Structure
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load Sample Package
              </button>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Structural Check Report</h2>

            <div *ngIf="!report && !verifying" class="text-center py-5 text-muted">
              Paste a public package and request structural checks.
            </div>

            <div *ngIf="verifying" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Checking declared payout arithmetic...</div>
            </div>

            <p *ngIf="error" class="alert alert-warning" role="alert">{{ error }}</p>
            <div *ngIf="report">
              <div class="alert" [ngClass]="report.valid === false ? 'alert-danger' : 'alert-warning'">
                <div class="fw-bold">{{ report.valid === false ? 'Structural errors detected' : 'Arithmetic checks passed; contract unverified' }}</div>
                <div class="small mt-1">{{ report.scope }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Total Collateral</div>
                <div class="fs-5 fw-bold">{{ report.total_collateral_sats === null ? 'Unknown' : (report.total_collateral_sats | number) + ' sat' }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">CET Count</div>
                <div class="fs-5 fw-bold">{{ report.cet_count }} Declared payout entries</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Refund Locktime</div>
                <div class="font-monospace small">Not verified by the arithmetic checker</div>
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
                This backend response does not establish chain state, oracle authenticity, funding ownership, valid adaptor signatures or executable settlement/refund transactions.
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
export class DlcInspectComponent implements OnInit, OnDestroy {
  packageInput = '';
  verifying = false;
  report: any = null;
  error: string | null = null;
  private request?: Subscription;
  private networkSubscription?: Subscription;

  constructor(private dlcApi: DlcApiService, private cdr: ChangeDetectorRef, private network: StateService) {}

  ngOnInit(): void {
    this.networkSubscription = this.network.networkChanged$.pipe(startWith(this.network.network), distinctUntilChanged()).subscribe(() => this.edited());
  }

  edited(): void {
    this.request?.unsubscribe();
    this.request = undefined;
    this.verifying = false;
    this.report = null;
    this.error = null;
    this.cdr.markForCheck();
  }

  loadSample(): void {
    this.edited();
    this.packageInput = JSON.stringify({
      parties: [{collateral_sats: 10000}, {collateral_sats: 10000}],
      cets: [{local_payout_sats: 9500, remote_payout_sats: 9500, fee_sats: 1000}],
      refund: {local_payout_sats: 9500, remote_payout_sats: 9500},
    }, null, 2);
  }

  verifyPackage(): void {
    this.edited();
    let pkg: unknown;
    try {
      if (this.packageInput.length > 500000) {throw new Error('Contract JSON exceeds the 500,000 character limit.');}
      const secret = looksLikeSecret(this.packageInput);
      if (secret) {this.packageInput = '';throw new Error(secret);}
      pkg = JSON.parse(this.packageInput);
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {throw new Error('Enter a public contract package JSON object.');}
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Invalid contract JSON.';
      return;
    }
    const digest = Array.from(sha256(new TextEncoder().encode(JSON.stringify(pkg))), b => b.toString(16).padStart(2, '0')).join('');
    const network = this.network.network || 'mainnet';
    this.verifying = true;
    this.request = this.dlcApi.verifyContractPackage$(pkg).subscribe({
      next: report => {
        this.verifying = false;
        const textList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 10000 && value.every(x => typeof x === 'string');
        if (!report || report.input_sha256 !== digest || report.configured_network !== network ||
          report.cryptographic_verification !== 'not-established' || typeof report.scope !== 'string' ||
          !textList(report.errors) || !textList(report.warnings) ||
          !Number.isSafeInteger(report.cet_count) || report.cet_count < 0 || report.cet_count > 4096 ||
          !(report.total_collateral_sats === null || Number.isSafeInteger(report.total_collateral_sats) && report.total_collateral_sats >= 0 && report.total_collateral_sats <= 2100000000000000) ||
          !(report.valid === null && report.structural_checks_passed === true && report.errors.length === 0 || report.valid === false && report.structural_checks_passed === false && report.errors.length > 0)) {
          this.error = 'The backend returned incomplete or mismatched structural evidence.';
        } else {this.report = report;}
        this.cdr.markForCheck();
      },
      error: error => {
        this.verifying = false;
        this.error = typeof error?.error?.error === 'string' ? error.error.error : 'The contract checker is unavailable.';
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {this.edited();this.networkSubscription?.unsubscribe();}
}
