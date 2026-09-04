import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PayjoinApiService, PayjoinPlaygroundSession } from './payjoin.service';

@Component({
  selector: 'app-payjoin-playground',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Payjoin Interactive Playground</h1>
          <span class="badge bg-primary">Safe Signet/Regtest Sandbox</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Step-by-step simulation of the collaborative Payjoin handshake between sender and receiver wallets with telemetry trace logging.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments/payjoin">Overview</a>
          <a class="nav-link" routerLink="/payments/payjoin/analyze">Proposal Analyzer</a>
          <a class="nav-link" routerLink="/payments/payjoin/directory">Directory Observatory</a>
          <a class="nav-link" routerLink="/payments/payjoin/compatibility">Compatibility Matrix</a>
          <a class="nav-link active" routerLink="/payments/payjoin/playground">Interactive Playground</a>
        </nav>
      </header>

      <!-- Start Session Card -->
      <div *ngIf="!session" class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Start Sandbox Collaborative Handshake</h2>
        <div class="row g-3 align-items-end">
          <div class="col-12 col-md-6">
            <label for="amountInput" class="form-label small text-muted">Simulated Payment Amount (Satoshis)</label>
            <input
              id="amountInput"
              type="number"
              class="form-control font-monospace"
              [(ngModel)]="amountSats"
              min="10000"
            />
          </div>
          <div class="col-12 col-md-6">
            <button class="btn btn-primary w-100" (click)="startSession()" [disabled]="starting">
              <span *ngIf="starting" class="spinner-border spinner-border-sm me-1" role="status"></span>
              {{ starting ? 'Initializing Session...' : 'Create Playground Session' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Active Session Stepper -->
      <div *ngIf="session" class="card p-4 mb-4 bg-body-tertiary border">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4 border-bottom pb-3">
          <div>
            <h2 class="h5 m-0 text-primary">Session: <code>{{ session.session_id }}</code></h2>
            <div class="small text-muted">Payment Value: {{ session.amount_sats | number }} sats</div>
          </div>
          <button class="btn btn-sm btn-outline-secondary" (click)="resetSession()">Reset Playground</button>
        </div>

        <!-- Step Indicators -->
        <div class="row g-3 mb-4 text-center">
          <div class="col-4">
            <div class="p-3 border rounded" [ngClass]="session.step === 'original_created' ? 'border-primary bg-body' : 'bg-body-secondary'">
              <div class="fw-bold small">Step 1</div>
              <div class="small">Original PSBT (Sender)</div>
            </div>
          </div>
          <div class="col-4">
            <div class="p-3 border rounded" [ngClass]="session.step === 'proposal_generated' ? 'border-primary bg-body' : 'bg-body-secondary'">
              <div class="fw-bold small">Step 2</div>
              <div class="small">Receiver UTXO Injection</div>
            </div>
          </div>
          <div class="col-4">
            <div class="p-3 border rounded" [ngClass]="session.step === 'signed_and_broadcast' ? 'border-success bg-body text-success' : 'bg-body-secondary'">
              <div class="fw-bold small">Step 3</div>
              <div class="small">Broadcast & Settle</div>
            </div>
          </div>
        </div>

        <!-- Next Action Button -->
        <div class="d-flex justify-content-between align-items-center" *ngIf="session.step !== 'signed_and_broadcast'">
          <span class="text-muted small">Advance simulation to next collaborative stage.</span>
          <button class="btn btn-primary" (click)="advanceSession()" [disabled]="advancing">
            <span *ngIf="advancing" class="spinner-border spinner-border-sm me-1" role="status"></span>
            {{ session.step === 'original_created' ? 'Generate Receiver Proposal' : 'Sign & Broadcast Payjoin' }}
          </button>
        </div>

        <div *ngIf="session.step === 'signed_and_broadcast'" class="alert alert-success mt-2 mb-0">
          <strong>Payjoin Complete!</strong> Collaborative transaction broadcast successfully with txid: <code>{{ session.payjoin_txid }}</code>
        </div>
      </div>

      <!-- Events Trace Log -->
      <div *ngIf="session && session.events_trace.length > 0" class="card p-4 bg-body-tertiary border">
        <h3 class="h6 mb-3">Telemetry Event Trace</h3>
        <ul class="list-group list-group-flush">
          <li *ngFor="let ev of session.events_trace" class="list-group-item bg-transparent px-0">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="fw-bold">{{ ev.phase }}</span>
              <span class="text-muted small">{{ ev.timestamp }}</span>
            </div>
            <div class="small text-muted">{{ ev.details }}</div>
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
export class PayjoinPlaygroundComponent {
  amountSats = 100000;
  starting = false;
  advancing = false;
  session: PayjoinPlaygroundSession | null = null;

  constructor(
    private api: PayjoinApiService,
    private cd: ChangeDetectorRef
  ) {}

  startSession(): void {
    this.starting = true;
    this.api.createPlaygroundSession$(this.amountSats).subscribe({
      next: s => {
        this.session = s;
        this.starting = false;
        this.cd.markForCheck();
      },
      error: () => {
        this.starting = false;
        this.cd.markForCheck();
      },
    });
  }

  advanceSession(): void {
    if (!this.session) return;
    this.advancing = true;
    this.api.advancePlaygroundSession$(this.session.session_id).subscribe({
      next: s => {
        this.session = s;
        this.advancing = false;
        this.cd.markForCheck();
      },
      error: () => {
        this.advancing = false;
        this.cd.markForCheck();
      },
    });
  }

  resetSession(): void {
    this.session = null;
    this.cd.markForCheck();
  }
}
