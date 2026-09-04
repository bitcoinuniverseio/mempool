import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConsensusApiService, CovenantSimulationResult } from './consensus.service';

@Component({
  selector: 'app-vaults-simulate',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Covenant Transaction Simulator</h1>
          <span class="badge bg-primary">State Machine Execution Engine</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Simulate spending conditions, relative timelocks, and state transitions across covenant scripts on proposed soft fork upgrades.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/labs/consensus">Consensus Proposals</a>
          <a class="nav-link" routerLink="/labs/consensus/compare">Compare Matrix</a>
          <a class="nav-link" routerLink="/labs/vaults">Vaults Overview</a>
          <a class="nav-link" routerLink="/labs/vaults/designer">Vault Designer</a>
          <a class="nav-link active" routerLink="/labs/vaults/simulate">Covenant Simulator</a>
        </nav>
      </header>

      <!-- Simulation Input Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Simulation Execution Parameters</h2>
        <form (ngSubmit)="runSimulation()" #simForm="ngForm">
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <label for="proposalSelect" class="form-label small text-muted">Consensus Upgrade Primitive</label>
              <select id="proposalSelect" class="form-select" [(ngModel)]="proposalId" name="proposalId" [disabled]="simulating">
                <option value="bip-119">BIP-119 (CHECKTEMPLATEVERIFY)</option>
                <option value="bip-347">BIP-347 (OP_CAT in Tapscript)</option>
                <option value="bip-443">BIP-443 (OP_TXHASH)</option>
              </select>
            </div>
            <div class="col-12 col-md-6">
              <label for="depositInput" class="form-label small text-muted">Vault Deposit Amount (Satoshis)</label>
              <input
                id="depositInput"
                type="number"
                class="form-control font-monospace"
                [(ngModel)]="depositSats"
                name="depositSats"
                min="10000"
                required
                [disabled]="simulating"
              />
            </div>
            <div class="col-12 col-md-6">
              <label for="unvaultKey" class="form-label small text-muted">Operating Hot Key</label>
              <input
                id="unvaultKey"
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="unvaultPubkey"
                name="unvaultPubkey"
                required
                [disabled]="simulating"
              />
            </div>
            <div class="col-12 col-md-6">
              <label for="recoveryKey" class="form-label small text-muted">Emergency Cold Key</label>
              <input
                id="recoveryKey"
                type="text"
                class="form-control font-monospace"
                [(ngModel)]="recoveryPubkey"
                name="recoveryPubkey"
                required
                [disabled]="simulating"
              />
            </div>
          </div>

          <div class="d-flex justify-content-end mt-4">
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="simulating || !unvaultPubkey || !recoveryPubkey"
            >
              <span *ngIf="simulating" class="spinner-border spinner-border-sm me-1" role="status"></span>
              {{ simulating ? 'Simulating Transitions...' : 'Execute Simulation' }}
            </button>
          </div>
        </form>
      </div>

      <!-- Error State -->
      <div *ngIf="errorMessage" class="alert alert-danger mb-4" role="alert">
        {{ errorMessage }}
      </div>

      <!-- Simulation Result -->
      <div *ngIf="result" class="card p-4 bg-body-tertiary border">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 border-bottom pb-2">
          <h2 class="h5 m-0 text-success">&check; Covenant Execution Valid</h2>
          <span class="badge bg-secondary">Estimated Witness Weight: {{ result.witness_weight_estimate }} WU</span>
        </div>

        <h3 class="h6 mb-2">Simulated State Transitions</h3>
        <div class="table-responsive mb-4">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>From State</th>
                <th>To State</th>
                <th>Trigger Condition</th>
                <th class="text-end">Delay (Blocks)</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let tr of result.state_transitions">
                <td class="fw-semibold">{{ tr.from_state }}</td>
                <td class="fw-semibold text-primary">&rarr; {{ tr.to_state }}</td>
                <td>{{ tr.trigger }}</td>
                <td class="text-end">{{ tr.delay_blocks ? tr.delay_blocks + ' blocks' : 'Immediate' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 class="h6 mb-2">Enforced Covenant Restrictions</h3>
        <ul class="list-group list-group-flush">
          <li *ngFor="let r of result.covenant_restrictions_summary" class="list-group-item bg-transparent text-muted small px-0">
            &bull; {{ r }}
          </li>
        </ul>
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
export class VaultsSimulateComponent {
  proposalId = 'bip-119';
  depositSats = 50000000;
  unvaultPubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  recoveryPubkey = '03c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
  simulating = false;
  errorMessage: string | null = null;
  result: CovenantSimulationResult | null = null;

  constructor(
    private api: ConsensusApiService,
    private cd: ChangeDetectorRef
  ) {}

  runSimulation(): void {
    this.simulating = true;
    this.errorMessage = null;
    this.result = null;

    this.api.simulateCovenant$({
      proposal_id: this.proposalId,
      covenant_script: 'OP_CHECKTEMPLATEVERIFY',
      deposit_sats: Number(this.depositSats),
      timelock_blocks: 144,
      recovery_pubkey: this.recoveryPubkey,
      unvault_pubkey: this.unvaultPubkey,
    }).subscribe({
      next: res => {
        this.result = res;
        this.simulating = false;
        this.cd.markForCheck();
      },
      error: err => {
        this.errorMessage = err?.error?.error || err?.message || 'Simulation failed';
        this.simulating = false;
        this.cd.markForCheck();
      },
    });
  }
}
