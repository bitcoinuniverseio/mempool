import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PayjoinApiService, PayjoinProposalAnalysisResult } from './payjoin.service';

@Component({
  selector: 'app-payjoin-analyze',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Payjoin Proposal Differential Analyzer</h1>
          <span class="badge bg-primary">BIP78 & BIP77 Diff Engine</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Perform side-by-side inspection between a sender's original PSBT and the receiver's returned Payjoin proposal PSBT.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments/payjoin">Overview</a>
          <a class="nav-link active" routerLink="/payments/payjoin/analyze">Proposal Analyzer</a>
          <a class="nav-link" routerLink="/payments/payjoin/directory">Directory Observatory</a>
          <a class="nav-link" routerLink="/payments/payjoin/compatibility">Compatibility Matrix</a>
          <a class="nav-link" routerLink="/payments/payjoin/playground">Interactive Playground</a>
        </nav>
      </header>

      <!-- Proposal Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Compare Original PSBT vs Proposal PSBT</h2>
        <form (ngSubmit)="analyze()" #diffForm="ngForm">
          <div class="row g-3">
            <div class="col-12 col-lg-6">
              <label for="origPsbt" class="form-label small text-muted">Original PSBT (Sender Constructed)</label>
              <textarea
                id="origPsbt"
                class="form-control font-monospace"
                rows="4"
                placeholder="Paste original sender PSBT..."
                [(ngModel)]="originalPsbt"
                name="originalPsbt"
                required
              ></textarea>
            </div>
            <div class="col-12 col-lg-6">
              <label for="propPsbt" class="form-label small text-muted">Proposal PSBT (Receiver Modified)</label>
              <textarea
                id="propPsbt"
                class="form-control font-monospace"
                rows="4"
                placeholder="Paste receiver Payjoin proposal PSBT..."
                [(ngModel)]="proposalPsbt"
                name="proposalPsbt"
                required
              ></textarea>
            </div>
          </div>

          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-4">
            <button
              type="button"
              class="btn btn-outline-secondary"
              (click)="loadDemoPsbts()"
            >
              Load Sample Payjoin Diff
            </button>
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="analyzing || !originalPsbt || !proposalPsbt"
            >
              <span *ngIf="analyzing" class="spinner-border spinner-border-sm me-1" role="status"></span>
              {{ analyzing ? 'Analyzing Proposal...' : 'Run Differential Analysis' }}
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
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 border-bottom pb-2">
          <h2 class="h5 m-0 text-success">&check; Valid {{ result.protocol_version }} Proposal Verified</h2>
          <span class="badge bg-success">+{{ result.privacy_score_gain }}% Privacy Rating</span>
        </div>

        <div class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Receiver Inputs Added</div>
              <div class="h4 my-1 text-primary">+{{ result.inputs_added_by_receiver }} UTXO</div>
              <div class="small text-muted">Collaborative input mix</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Receiver Contribution</div>
              <div class="h4 my-1 text-success">{{ result.receiver_contributed_sats | number }} sats</div>
              <div class="small text-muted">Injected receiver liquidity</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Fee Adjustment</div>
              <div class="h4 my-1 text-warning">+{{ result.fee_delta_sats }} sats</div>
              <div class="small text-muted">BIP78 fee coverage compliant</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Effective Feerate</div>
              <div class="h4 my-1 text-info">{{ result.effective_feerate_sats_vb }} sat/vB</div>
              <div class="small text-muted">Calculated package rate</div>
            </div>
          </div>
        </div>

        <!-- Broken Heuristics List -->
        <h3 class="h6 mb-2">Broken Surveillance Heuristics</h3>
        <ul class="list-group mb-3">
          <li *ngFor="let h of result.heuristics_broken" class="list-group-item bg-transparent d-flex align-items-center gap-2">
            <span class="text-success">&check;</span>
            <span class="fw-semibold">{{ h }}</span>
          </li>
        </ul>

        <!-- Validation Notes -->
        <h3 class="h6 mb-2">Verification Audit Log</h3>
        <ul class="list-group list-group-flush">
          <li *ngFor="let msg of result.validation_messages" class="list-group-item bg-transparent text-muted small px-0">
            &bull; {{ msg }}
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
export class PayjoinAnalyzeComponent {
  originalPsbt = '';
  proposalPsbt = '';
  analyzing = false;
  errorMessage: string | null = null;
  result: PayjoinProposalAnalysisResult | null = null;

  constructor(
    private api: PayjoinApiService,
    private cd: ChangeDetectorRef
  ) {}

  loadDemoPsbts(): void {
    this.originalPsbt = 'cHNidP8BAFICAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAAAAA==';
    this.proposalPsbt = 'cHNidP8BAFICAAAAAgAAAAAAAAAAAAAAAgAAAAAAAAAAAA==';
    this.analyze();
  }

  analyze(): void {
    if (!this.originalPsbt || !this.proposalPsbt) return;
    this.analyzing = true;
    this.errorMessage = null;
    this.result = null;

    this.api.analyzeProposal$(this.originalPsbt.trim(), this.proposalPsbt.trim()).subscribe({
      next: res => {
        this.result = res;
        this.analyzing = false;
        this.cd.markForCheck();
      },
      error: err => {
        this.errorMessage = err?.error?.error || err?.message || 'Failed to analyze proposal';
        this.analyzing = false;
        this.cd.markForCheck();
      },
    });
  }
}
