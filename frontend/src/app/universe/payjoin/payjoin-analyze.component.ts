import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnDestroy,
  Inject,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { PAYJOIN_SAMPLE } from './payjoin-sample';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  PayjoinApiService,
  PayjoinProposalAnalysisResult,
} from './payjoin.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-payjoin-analyze',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div
          class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2"
        >
          <h1 class="m-0">Payjoin Proposal Differential Analyzer</h1>
          <span class="badge bg-primary">BIP78 Transaction Comparison</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Perform side-by-side inspection between a sender's original PSBT and
          the receiver's returned Payjoin proposal PSBT.
        </p>

        <!-- Navigation Tabs -->
        <nav
          class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle"
        >
          <a class="nav-link" [routerLink]="'/payments/payjoin' | relativeUrl"
            >Overview</a
          >
          <a
            class="nav-link active"
            [routerLink]="'/payments/payjoin/analyze' | relativeUrl"
            >Proposal Analyzer</a
          >
          <a
            class="nav-link"
            [routerLink]="'/payments/payjoin/directory' | relativeUrl"
            >Directory Observatory</a
          >
          <a
            class="nav-link"
            [routerLink]="'/payments/payjoin/compatibility' | relativeUrl"
            >Compatibility Matrix</a
          >
          <a
            class="nav-link"
            [routerLink]="'/payments/payjoin/playground' | relativeUrl"
            >Interactive Playground</a
          >
        </nav>
      </header>

      <!-- Proposal Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Compare Original PSBT vs Proposal PSBT</h2>
        <form (ngSubmit)="analyze()" #diffForm="ngForm">
          <div class="row g-3">
            <div class="col-12 col-lg-6">
              <label for="origPsbt" class="form-label small text-muted"
                >Original PSBT (Sender Constructed)</label
              >
              <textarea
                id="origPsbt"
                class="form-control font-monospace"
                rows="4"
                placeholder="Paste original sender PSBT..."
                [(ngModel)]="originalPsbt"
                (ngModelChange)="edited()"
                name="originalPsbt"
                required
              ></textarea>
            </div>
            <div class="col-12 col-lg-6">
              <label for="propPsbt" class="form-label small text-muted"
                >Proposal PSBT (Receiver Modified)</label
              >
              <textarea
                id="propPsbt"
                class="form-control font-monospace"
                rows="4"
                placeholder="Paste receiver Payjoin proposal PSBT..."
                [(ngModel)]="proposalPsbt"
                (ngModelChange)="edited()"
                name="proposalPsbt"
                required
              ></textarea>
            </div>
          </div>
          <label for="payjoin-final-psbt"
            >Final signed PSBT (optional; signing happens in your wallet)</label
          ><textarea
            id="payjoin-final-psbt"
            name="finalPsbt"
            class="form-control font-monospace"
            rows="3"
            [(ngModel)]="finalPsbt"
            (ngModelChange)="edited()"
          ></textarea>
          <label for="payjoin-min-feerate">Minimum final feerate (sat/vB)</label
          ><input
            id="payjoin-min-feerate"
            name="minFeerate"
            type="number"
            min="0"
            class="form-control"
            [(ngModel)]="minFeerate"
            (ngModelChange)="edited()"
          />
          <p class="small">
            Optional final validation checks every signature, current owned
            UTXOs and the owned node's mempool policy. This tool does not
            broadcast transactions.
          </p>

          <p class="small mt-3">
            All original outputs are protected by default. Enter the original
            payment output index only if you know which output belongs to the
            receiver. Indexes start at zero.
          </p>
          <label for="payjoin-payment-index"
            >Payment output index (optional)</label
          >
          <input
            id="payjoin-payment-index"
            name="paymentIndex"
            type="number"
            min="0"
            step="1"
            [(ngModel)]="paymentIndex"
            (ngModelChange)="edited()"
            class="form-control"
          />
          <label
            ><input
              name="disableSubstitution"
              type="checkbox"
              [(ngModel)]="disableSubstitution"
              (ngModelChange)="edited()"
            />
            Protect the payment script and amount</label
          >
          <div class="row mt-2">
            <div class="col-sm-6">
              <label for="payjoin-fee-index"
                >Authorized fee output index (optional)</label
              ><input
                id="payjoin-fee-index"
                name="feeIndex"
                type="number"
                min="0"
                step="1"
                [(ngModel)]="feeIndex"
                (ngModelChange)="edited()"
                class="form-control"
              />
            </div>
            <div class="col-sm-6">
              <label for="payjoin-fee-limit"
                >Maximum extra sender fee (sats)</label
              ><input
                id="payjoin-fee-limit"
                name="feeLimit"
                type="number"
                min="0"
                step="1"
                [(ngModel)]="feeLimit"
                (ngModelChange)="edited()"
                class="form-control"
              />
            </div>
          </div>
          <div
            class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-4"
          >
            <button
              type="button"
              class="btn btn-outline-secondary"
              (click)="loadDemoPsbts()"
            >
              Load Synthetic Signed Sample
            </button>
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="analyzing || !originalPsbt || !proposalPsbt"
            >
              <span
                *ngIf="analyzing"
                class="spinner-border spinner-border-sm me-1"
                role="status"
              ></span>
              {{
                analyzing
                  ? 'Analyzing Proposal...'
                  : 'Run Differential Analysis'
              }}
            </button>
          </div>
        </form>
      </div>

      <!-- Error State -->
      <div *ngIf="errorMessage" class="alert alert-danger mb-4" role="alert">
        {{ errorMessage }}
      </div>

      <!-- Results -->
      <div *ngIf="result" class="card p-4 bg-body-tertiary border">
        <div
          class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 border-bottom pb-2"
        >
          <h2 class="h5 m-0" [class.text-danger]="result.is_valid === false">
            {{
              result.is_valid === true
                ? 'Signed transaction passed owned-node checks'
                : result.is_valid === false
                  ? 'Proposal checks failed'
                  : 'Comparison passed; signing acceptance unestablished'
            }}
          </h2>
          <span class="badge bg-secondary">{{
            result.verification_scope
          }}</span>
        </div>
        <p>
          Original and receiver scripts:
          {{
            result.signatures_verified === true
              ? 'Verified'
              : result.signatures_verified === false
                ? 'Invalid'
                : 'Not established'
          }}. Current owned UTXOs:
          {{
            result.chain_verified === true
              ? 'Matched'
              : result.chain_verified === false
                ? 'Unavailable or inconsistent'
                : 'Not established'
          }}.
        </p>
        <p *ngIf="result.final_signatures_verified !== undefined">
          Final scripts:
          {{ result.final_signatures_verified ? 'Verified' : 'Not verified' }}.
          Owned mempool policy:
          {{
            result.node_policy_accepted
              ? 'Accepted at observation time'
              : 'Not accepted'
          }}. Final size: {{ result.final_vsize }} vB; feerate:
          {{ result.final_feerate_sats_vb | number: '1.0-3' }} sat/vB.
        </p>

        <div class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Receiver Inputs Added</div>
              <div class="h4 my-1 text-primary">
                +{{ result.inputs_added_by_receiver }} UTXO
              </div>
              <div class="small text-muted">Collaborative input mix</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Receiver Contribution</div>
              <div class="h4 my-1 text-success">
                {{
                  result.receiver_contributed_sats !== null
                    ? (result.receiver_contributed_sats | number) + ' sats'
                    : 'unknown (no UTXO data)'
                }}
              </div>
              <div class="small text-muted">Injected receiver liquidity</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Fee Adjustment</div>
              <div class="h4 my-1 text-warning">
                {{
                  result.fee_delta_sats !== null
                    ? (result.fee_delta_sats >= 0 ? '+' : '') +
                      result.fee_delta_sats +
                      ' sats'
                    : 'unknown (no UTXO data)'
                }}
              </div>
              <div class="small text-muted">
                Difference from supplied UTXO amounts
              </div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Final Transaction Feerate</div>
              <div class="h4 my-1 text-info">
                {{
                  result.final_feerate_sats_vb != null
                    ? (result.final_feerate_sats_vb | number: '1.0-3') + ' sat/vB'
                    : 'unknown'
                }}
              </div>
              <div class="small text-muted">
                Calculated from final transaction
              </div>
            </div>
          </div>
        </div>

        <!-- Broken Heuristics List -->
        <h3 class="h6 mb-2">Observed Transaction Structure</h3>
        <ul class="list-group mb-3">
          <li
            *ngFor="let h of result.heuristics_broken"
            class="list-group-item bg-transparent d-flex align-items-center gap-2"
          >
            <span class="text-success">&check;</span>
            <span class="fw-semibold">{{ h }}</span>
          </li>
        </ul>

        <!-- Validation Notes -->
        <h3 class="h6 mb-2">Verification Audit Log</h3>
        <ul class="list-group list-group-flush">
          <li
            *ngFor="let msg of result.validation_messages"
            class="list-group-item bg-transparent text-muted small px-0"
          >
            &bull; {{ msg }}
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
export class PayjoinAnalyzeComponent implements OnDestroy {
  originalPsbt = '';
  proposalPsbt = '';
  paymentIndex: number | null = null;
  disableSubstitution = true;
  feeIndex: number | null = null;
  feeLimit: number | null = null;
  finalPsbt = '';
  minFeerate: number | null = null;
  analyzing = false;
  errorMessage: string | null = null;
  result: PayjoinProposalAnalysisResult | null = null;
  private pending?: Subscription;
  private generation = 0;
  private networkSubscription: Subscription;

  edited(): void {
    this.generation++;
    this.pending?.unsubscribe();
    this.pending = undefined;
    this.result = null;
    this.errorMessage = null;
    this.analyzing = false;
  }
  ngOnDestroy(): void {
    this.edited();
    this.networkSubscription.unsubscribe();
  }

  constructor(
    @Inject(PayjoinApiService) private api: PayjoinApiService,
    @Inject(ChangeDetectorRef) private cd: ChangeDetectorRef,
    @Inject(StateService) state: StateService
  ) {
    this.networkSubscription = state.networkChanged$.subscribe(() => {
      this.edited();
      this.cd.markForCheck();
    });
  }

  loadDemoPsbts(): void {
    this.originalPsbt = PAYJOIN_SAMPLE.original_psbt;
    this.proposalPsbt = PAYJOIN_SAMPLE.proposal_psbt;
    this.paymentIndex = 0;
    this.disableSubstitution = true;
    this.feeIndex = null;
    this.feeLimit = null;
    this.finalPsbt = '';
    this.minFeerate = null;
    this.analyze();
  }

  analyze(): void {
    this.edited();
    if (!this.originalPsbt || !this.proposalPsbt) return;
    const generation = this.generation;
    this.analyzing = true;
    this.errorMessage = null;
    this.result = null;

    const policy = {
      ...(this.paymentIndex !== null
        ? {
            payment_output_index: this.paymentIndex,
            disable_output_substitution: this.disableSubstitution,
          }
        : {}),
      ...(this.feeIndex !== null
        ? { additional_fee_output_index: this.feeIndex }
        : {}),
      ...(this.feeLimit !== null
        ? { max_additional_fee_contribution: this.feeLimit }
        : {}),
      ...(this.finalPsbt.trim()
        ? { final_signed_psbt: this.finalPsbt.trim() }
        : {}),
      ...(this.minFeerate !== null ? { min_feerate: this.minFeerate } : {}),
    };
    this.pending = this.api
      .analyzeProposal$(
        this.originalPsbt.trim(),
        this.proposalPsbt.trim(),
        policy
      )
      .subscribe({
        next: (res) => {
          if (generation !== this.generation) return;
          this.result = res;
          this.analyzing = false;
          this.cd.markForCheck();
        },
        error: (err) => {
          if (generation !== this.generation) return;
          this.errorMessage =
            err?.error?.error || err?.message || 'Failed to analyze proposal';
          this.analyzing = false;
          this.cd.markForCheck();
        },
      });
  }
}
