import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, distinctUntilChanged, startWith } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { DlcApiService } from './dlc.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { rawTransactionId } from '../private-submission/submission-validation';

@Component({
  selector: 'app-dlc-simulate', standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>DLC Regtest Simulator</h1>
        <p>Request a contract lifecycle simulation from the configured simulator. Its availability and execution evidence must be established by that source.</p>
        <nav class="nav nav-pills flex-wrap gap-2">
          <a class="nav-link" [routerLink]="'/contracts/dlc' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/contracts/dlc/oracles' | relativeUrl">Oracles</a>
          <a class="nav-link" [routerLink]="'/contracts/dlc/inspect' | relativeUrl">Contract Inspector</a>
        </nav>
      </header>
      <section class="card p-4 mb-4">
        <h2 class="h5">Simulation request</h2>
        <label for="dlc-simulate-scenario">Scenario</label>
        <select id="dlc-simulate-scenario" class="form-select mb-3" [(ngModel)]="scenarioType" (ngModelChange)="edited()">
          <option value="settlement">Settlement</option><option value="oracle_outage">Oracle outage</option>
          <option value="conflicting_attestations">Conflicting attestations</option><option value="refund_timeout">Refund timeout</option><option value="reorg">Reorganization</option>
        </select>
        <label for="dlc-simulate-contract">Existing simulator contract ID</label>
        <input id="dlc-simulate-contract" class="form-control mb-3" [(ngModel)]="contractId" (ngModelChange)="edited()" maxlength="128" />
        <label for="dlc-simulate-oracle">Oracle IDs (comma separated)</label>
        <input id="dlc-simulate-oracle" class="form-control mb-3" [(ngModel)]="selectedOracle" (ngModelChange)="edited()" maxlength="2048" />
        <label for="dlc-simulate-outcome">Outcome (optional)</label>
        <input id="dlc-simulate-outcome" class="form-control mb-3" [(ngModel)]="outcome" (ngModelChange)="edited()" maxlength="128" />
        <button class="btn btn-primary" (click)="runSimulation()" [disabled]="simulating">Request Simulation</button>
      </section>
      <p *ngIf="simulating" role="status">Waiting for the simulator…</p>
      <p *ngIf="error" role="alert" class="alert alert-warning">{{ error }}</p>
      <section *ngIf="result" class="card p-4">
        <h2 class="h5">Reported simulation result</h2>
        <p>Status: {{ result.status }}</p><p>{{ result.message }}</p>
        <p>Funding transaction decoded from response: <code>{{ fundingTxid }}</code></p>
        <p>Closing transaction decoded from response: <code>{{ closingTxid }}</code></p>
        <p>These are source-reported simulation outputs. Decoding transaction bytes does not establish valid signatures, consensus execution, current funding ownership or a mined settlement.</p>
      </section>
    </div>
  `,
})
export class DlcSimulateComponent implements OnInit, OnDestroy {
  scenarioType = 'settlement';
  selectedOracle = '';
  contractId = '';
  outcome = '';
  simulating = false;
  result: any = null;
  error: string | null = null;
  fundingTxid: string | null = null;
  closingTxid: string | null = null;
  private request?: Subscription;
  private networkSubscription?: Subscription;

  constructor(private dlcApi: DlcApiService, private cdr: ChangeDetectorRef, private network: StateService) {}
  ngOnInit(): void {
    this.networkSubscription = this.network.networkChanged$.pipe(startWith(this.network.network), distinctUntilChanged()).subscribe(() => this.edited());
  }
  edited(): void {
    this.request?.unsubscribe();this.request = undefined;this.simulating = false;
    this.result = null;this.error = null;this.fundingTxid = null;this.closingTxid = null;this.cdr.markForCheck();
  }
  runSimulation(): void {
    this.edited();
    const oracles = this.selectedOracle.split(',').map(id => id.trim()).filter(Boolean);
    const id = /^[A-Za-z0-9._:-]{1,128}$/;
    if (!['settlement','oracle_outage','conflicting_attestations','refund_timeout','reorg'].includes(this.scenarioType) ||
      !id.test(this.contractId) || !oracles.length || oracles.length > 16 || new Set(oracles).size !== oracles.length ||
      oracles.some(value => !id.test(value)) || this.outcome.length > 128) {
      this.error = 'Enter an existing contract ID, 1–16 distinct oracle IDs and a supported scenario.';return;
    }
    const params = {scenario: this.scenarioType, contract_id: this.contractId, oracle_ids: oracles, ...(this.outcome ? {outcome: this.outcome} : {})};
    this.simulating = true;
    this.request = this.dlcApi.runSimulation$(params).subscribe({
      next: result => {
        this.simulating = false;
        try {
          if (!result || result.contract_id !== params.contract_id || result.scenario !== params.scenario ||
            !Array.isArray(result.oracle_ids) || JSON.stringify(result.oracle_ids) !== JSON.stringify(params.oracle_ids) ||
            !['simulated_success','simulated_refund','simulated_conflict'].includes(result.status) || typeof result.message !== 'string' ||
            typeof result.funding_tx_hex !== 'string' || typeof result.closing_tx_hex !== 'string' ||
            result.funding_tx_hex.length > 800000 || result.closing_tx_hex.length > 800000) {throw new Error('Unbound simulation response');}
          this.fundingTxid = rawTransactionId(result.funding_tx_hex);
          this.closingTxid = rawTransactionId(result.closing_tx_hex);
          this.result = result;
        } catch {
          this.fundingTxid = null;this.closingTxid = null;this.error = 'The simulator returned incomplete or mismatched execution data.';
        }
        this.cdr.markForCheck();
      },
      error: error => {
        this.simulating = false;
        this.error = typeof error?.error?.error === 'string' ? error.error.error : 'The configured DLC simulator is unavailable.';
        this.cdr.markForCheck();
      },
    });
  }
  ngOnDestroy(): void {this.edited();this.networkSubscription?.unsubscribe();}
}
