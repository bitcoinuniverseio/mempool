import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnDestroy,
  Inject,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  ConsensusApiService,
  CovenantSimulationResult,
} from './consensus.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-vaults-simulate',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div
          class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2"
        >
          <h1 class="m-0">Covenant Transaction Simulator</h1>
          <span class="badge bg-primary">BIP119 Template Checker</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Check a bare CTV script against a spending transaction. A matching
          commitment does not establish vault execution, signatures, timelock
          maturity or chain activation.
        </p>

        <!-- Navigation Tabs -->
        <nav
          class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle"
        >
          <a class="nav-link" [routerLink]="'/labs/consensus' | relativeUrl"
            >Consensus Proposals</a
          >
          <a
            class="nav-link"
            [routerLink]="'/labs/consensus/compare' | relativeUrl"
            >Compare Matrix</a
          >
          <a class="nav-link" [routerLink]="'/labs/vaults' | relativeUrl"
            >Vaults Overview</a
          >
          <a
            class="nav-link"
            [routerLink]="'/labs/vaults/designer' | relativeUrl"
            >Vault Designer</a
          >
          <a
            class="nav-link active"
            [routerLink]="'/labs/vaults/simulate' | relativeUrl"
            >Covenant Simulator</a
          >
        </nav>
      </header>

      <!-- Simulation Input Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Transaction Template Inputs</h2>
        <form (ngSubmit)="runSimulation()" #simForm="ngForm">
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <label for="proposalSelect" class="form-label small text-muted"
                >Consensus Upgrade Primitive</label
              >
              <select
                id="proposalSelect"
                class="form-select"
                [(ngModel)]="proposalId"
                (ngModelChange)="edited()"
                name="proposalId"
                [disabled]="simulating"
              >
                <option value="bip-119">BIP-119 (CHECKTEMPLATEVERIFY)</option>
                <option value="bip-347">BIP-347 (OP_CAT in Tapscript)</option>
                <option value="bip-443">
                  BIP-443 (OP_CHECKCONTRACTVERIFY)
                </option>
              </select>
            </div>
          </div>

          <label for="ctv-transaction">Spending transaction hex</label
          ><textarea
            id="ctv-transaction"
            name="transactionHex"
            class="form-control font-monospace"
            [(ngModel)]="transactionHex"
            (ngModelChange)="edited()"
            rows="4"
          ></textarea>
          <label for="ctv-script"
            >Bare covenant script hex (20 + 32-byte hash + b3)</label
          ><input
            id="ctv-script"
            name="covenantScript"
            class="form-control font-monospace"
            [(ngModel)]="covenantScript"
            (ngModelChange)="edited()"
          />
          <label for="ctv-index">Executing input index</label
          ><input
            id="ctv-index"
            name="inputIndex"
            type="number"
            min="0"
            step="1"
            class="form-control"
            [(ngModel)]="inputIndex"
            (ngModelChange)="edited()"
          />
          <div class="d-flex justify-content-end mt-4">
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="simulating || !transactionHex || !covenantScript"
            >
              <span
                *ngIf="simulating"
                class="spinner-border spinner-border-sm me-1"
                role="status"
              ></span>
              {{
                simulating
                  ? 'Checking Template...'
                  : 'Check Transaction Template'
              }}
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
        <div
          class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 border-bottom pb-2"
        >
          <h2 class="h5 m-0" [class.text-danger]="!result.template_matches">
            {{
              result.template_matches
                ? 'Template matches; full execution unestablished'
                : 'Template mismatch'
            }}
          </h2>
          <span class="badge bg-secondary"
            >Witness weight:
            {{
              result.witness_weight_estimate === null
                ? 'Unknown'
                : result.witness_weight_estimate + ' WU'
            }}</span
          >
        </div>
        <p>{{ result.scope }}</p>
        <p class="font-monospace text-break">
          Calculated template hash: {{ result.calculated_template_hash }}
        </p>

        <h3 class="h6 mb-2">Simulated State Transitions</h3>
        <div class="table-responsive mb-4" tabindex="0">
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
                <td class="fw-semibold text-primary">
                  &rarr; {{ tr.to_state }}
                </td>
                <td>{{ tr.trigger }}</td>
                <td class="text-end">
                  {{
                    tr.delay_blocks ? tr.delay_blocks + ' blocks' : 'Immediate'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 class="h6 mb-2">Enforced Covenant Restrictions</h3>
        <ul class="list-group list-group-flush">
          <li
            *ngFor="let r of result.covenant_restrictions_summary"
            class="list-group-item bg-transparent text-muted small px-0"
          >
            &bull; {{ r }}
          </li>
        </ul>
      </div>
    </div>
  `,
  styles: [
    `
      .nav-link {
        color: inherit;
        padding: 0.4rem 0.8rem;
        border-radius: 0.375rem;
      }
      .nav-link.active {
        background-color: var(--bs-primary, #f7931a);
        color: #fff;
      }
    `,
  ],
})
export class VaultsSimulateComponent implements OnDestroy {
  proposalId = 'bip-119';
  simulating = false;
  errorMessage: string | null = null;
  result: CovenantSimulationResult | null = null;
  transactionHex = '';
  covenantScript = '';
  inputIndex = 0;
  private request?: Subscription;
  private network: Subscription;
  private revision = 0;
  edited(): void {
    this.revision++;
    this.request?.unsubscribe();
    this.result = null;
    this.errorMessage = null;
    this.simulating = false;
  }
  ngOnDestroy(): void {
    this.edited();
    this.network.unsubscribe();
  }

  constructor(
    @Inject(ConsensusApiService) private api: ConsensusApiService,
    @Inject(ChangeDetectorRef) private cd: ChangeDetectorRef,
    @Inject(StateService) state: StateService
  ) {
    this.network = state.networkChanged$.subscribe(() => {
      this.edited();
      this.cd.markForCheck();
    });
  }

  runSimulation(): void {
    this.edited();
    const revision = this.revision;
    this.simulating = true;
    this.errorMessage = null;
    this.result = null;

    this.request = this.api
      .simulateCovenant$({
        proposal_id: this.proposalId,
        covenant_script: this.covenantScript,
        transaction_hex: this.transactionHex,
        input_index: this.inputIndex,
      })
      .subscribe({
        next: (res) => {
          if (revision !== this.revision) return;
          this.result = res;
          this.simulating = false;
          this.cd.markForCheck();
        },
        error: (err) => {
          if (revision !== this.revision) return;
          this.errorMessage =
            err?.error?.error || err?.message || 'Simulation failed';
          this.simulating = false;
          this.cd.markForCheck();
        },
      });
  }
}
