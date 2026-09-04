import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DlcApiService } from './dlc.service';

@Component({
  selector: 'app-dlc-simulate',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">DLC Regtest Simulator</h1>
          <span class="badge bg-warning text-dark">Simulated Environment</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Simulate Discreet Log Contract lifecycles, CET execution, oracle outages, and refund paths without signing or broadcasting live transactions.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/contracts/dlc">Overview</a>
          <a class="nav-link" routerLink="/contracts/dlc/oracles">Oracles</a>
          <a class="nav-link" routerLink="/contracts/dlc/events">Events</a>
          <a class="nav-link" routerLink="/contracts/dlc/inspect">Contract Inspector</a>
          <a class="nav-link active" routerLink="/contracts/dlc/simulate">Regtest Simulator</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Simulation Configuration</h2>

            <div class="mb-3">
              <label class="form-label small text-muted">Scenario Type</label>
              <select class="form-select" [(ngModel)]="scenarioType">
                <option value="normal_cet_settlement">Normal Settlement (Outcome Attested)</option>
                <option value="oracle_outage_refund">Oracle Outage (Unilateral Refund)</option>
                <option value="conflicting_oracle_equivocation">Conflicting Oracle Equivocation</option>
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted">Oracle Selection</label>
              <select class="form-select" [(ngModel)]="selectedOracle">
                <option value="oracle-kormir-rates">Kormir Public Reference Oracle</option>
                <option value="oracle-crypto-equivocator">Simulated Equivocating Oracle</option>
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted">Total Collateral (Satoshis)</label>
              <input type="number" class="form-control" [(ngModel)]="collateralSat" />
            </div>

            <button class="btn btn-primary w-100" (click)="runSimulation()" [disabled]="simulating">
              <span *ngIf="simulating" class="spinner-border spinner-border-sm me-1"></span>
              Execute Simulation
            </button>
          </div>
        </div>

        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Execution Result</h2>

            <div *ngIf="!result && !simulating" class="text-center py-5 text-muted">
              Select simulation parameters and click Execute Simulation.
            </div>

            <div *ngIf="simulating" class="text-center py-5 text-muted">
              <div class="spinner-border text-primary mb-2"></div>
              <div>Computing script trees and adaptor signature verification...</div>
            </div>

            <div *ngIf="result">
              <div class="alert alert-success py-2 px-3 mb-3">
                Simulation completed deterministically in local sandbox.
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Status</div>
                    <div class="fw-bold">{{ result.status | uppercase }}</div>
                  </div>
                </div>
                <div class="col-6">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Simulated Outcome</div>
                    <div class="fw-bold">{{ result.settled_outcome || 'N/A' }}</div>
                  </div>
                </div>
              </div>

              <div class="mb-3">
                <div class="text-muted small mb-1">Simulated Funding Transaction ID</div>
                <div class="font-monospace small p-2 border rounded bg-body text-break">
                  {{ result.funding_txid }}
                </div>
              </div>

              <div class="mb-3" *ngIf="result.executed_cet_txid">
                <div class="text-muted small mb-1">Simulated Settled CET ID</div>
                <div class="font-monospace small p-2 border rounded bg-body text-break">
                  {{ result.executed_cet_txid }}
                </div>
              </div>

              <div class="mb-3" *ngIf="result.refund_txid">
                <div class="text-muted small mb-1">Simulated Refund Transaction ID</div>
                <div class="font-monospace small p-2 border rounded bg-body text-break">
                  {{ result.refund_txid }}
                </div>
              </div>

              <div class="alert alert-warning py-2 px-3 small m-0">
                Notice: Simulation runs are purely theoretical calculations. No Bitcoin transactions are constructed with live keys or broadcast to the network.
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
export class DlcSimulateComponent {
  scenarioType = 'normal_cet_settlement';
  selectedOracle = 'oracle-kormir-rates';
  collateralSat = 20000000;
  simulating = false;
  result: any = null;

  constructor(private dlcApi: DlcApiService, private cdr: ChangeDetectorRef) {}

  runSimulation(): void {
    this.simulating = true;
    this.result = null;

    this.dlcApi
      .runSimulation$({
        scenario_type: this.scenarioType,
        oracle_id: this.selectedOracle,
        collateral_sat: this.collateralSat,
      })
      .subscribe({
        next: (res) => {
          this.result = res;
          this.simulating = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.simulating = false;
          this.result = {
            status: 'error',
            error: err.message || 'Simulation execution failed',
          };
          this.cdr.markForCheck();
        },
      });
  }
}
