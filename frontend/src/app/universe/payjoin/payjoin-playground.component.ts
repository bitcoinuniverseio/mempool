import { Component, ChangeDetectionStrategy, ChangeDetectorRef, Inject, OnDestroy } from '@angular/core';
import { Subscription, take, timeout } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PayjoinApiService, PayjoinPlaygroundSession } from './payjoin.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-payjoin-playground',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Payjoin Interactive Playground</h1>
          <span class="badge bg-primary">Narrated Simulation</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Step-by-step simulation of the collaborative Payjoin handshake between sender and receiver wallets with a simulated event trace. This service builds no PSBT and performs no signing or broadcast.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/payments/payjoin' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/payments/payjoin/analyze' | relativeUrl">Proposal Analyzer</a>
          <a class="nav-link" [routerLink]="'/payments/payjoin/directory' | relativeUrl">Directory Observatory</a>
          <a class="nav-link" [routerLink]="'/payments/payjoin/compatibility' | relativeUrl">Compatibility Matrix</a>
          <a class="nav-link active" [routerLink]="'/payments/payjoin/playground' | relativeUrl">Interactive Playground</a>
        </nav>
      </header>

      <p class="alert alert-secondary" id="payjoin-wallet-prerequisites">Actual Sign &amp; Broadcast is unavailable here. It requires a connected signing wallet, owned spendable UTXOs, a supported BIP77 or BIP78 sender/receiver workflow, and an operated broadcast endpoint. This API supplies only a narrated simulation.</p>
      <button class="btn btn-outline-secondary mb-3" disabled aria-describedby="payjoin-wallet-prerequisites">Sign &amp; Broadcast Payjoin: unavailable</button>
      <div *ngIf="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }} Retry the current step or reset the simulation.</div>
      <!-- Start Session Card -->
      <div *ngIf="!session" class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Start Simulated Collaborative Handshake</h2>
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
              <div class="small">Signing and Broadcast Walkthrough</div>
            </div>
          </div>
        </div>

        <!-- Next Action Button -->
        <div class="d-flex justify-content-between align-items-center" *ngIf="session.step !== 'signed_and_broadcast'">
          <span class="text-muted small">Advance simulation to next collaborative stage.</span>
          <button class="btn btn-primary" (click)="advanceSession()" [disabled]="advancing">
            <span *ngIf="advancing" class="spinner-border spinner-border-sm me-1" role="status"></span>
            {{ session.step === 'original_created' ? 'Explain Receiver Proposal' : 'Explain Signing & Broadcast' }}
          </button>
        </div>

        <div *ngIf="session.step === 'signed_and_broadcast'" class="alert alert-success mt-2 mb-0">
          <strong>Walkthrough complete.</strong> This playground narrates the protocol; nothing was signed or broadcast and there is no transaction id.
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
export class PayjoinPlaygroundComponent implements OnDestroy {
  amountSats = 100000;
  starting = false;
  advancing = false;
  session: PayjoinPlaygroundSession | null = null;

  errorMessage: string | null = null;
  private pending?: Subscription;
  private generation = 0;
  private networkSubscription: Subscription;

  constructor(
    @Inject(PayjoinApiService) private api: PayjoinApiService,
    @Inject(ChangeDetectorRef) private cd: ChangeDetectorRef,
    @Inject(StateService) state: StateService
  ) {
    this.networkSubscription = state.networkChanged$.subscribe(() => this.resetSession());
  }

  private cancelPending(): void {
    this.generation++;
    this.pending?.unsubscribe();
    this.pending = undefined;
    this.starting = false;
    this.advancing = false;
  }

  private validSession(value: PayjoinPlaygroundSession): boolean {
    return value?.simulated === true && value.original_txid === null && value.payjoin_txid === null &&
      typeof value.session_id === 'string' && value.session_id.length > 0 &&
      ['original_created', 'proposal_generated', 'signed_and_broadcast'].includes(value.step) &&
      Array.isArray(value.events_trace);
  }

  startSession(): void {
    if (this.starting || this.advancing) return;
    if (!Number.isSafeInteger(this.amountSats) || this.amountSats <= 0 || this.amountSats > 21e14) {
      this.errorMessage = 'Enter a positive whole number of satoshis within the Bitcoin supply limit.';
      return;
    }
    this.cancelPending();
    const generation = this.generation;
    this.errorMessage = null;
    this.starting = true;
    this.pending = this.api.createPlaygroundSession$(this.amountSats).pipe(take(1), timeout(15000)).subscribe({
      next: value => {
        if (generation !== this.generation) return;
        this.starting = false;
        if (this.validSession(value)) this.session = value;
        else this.errorMessage = 'The service returned an unsupported simulation response.';
        this.cd.markForCheck();
      },
      error: () => {
        if (generation !== this.generation) return;
        this.errorMessage = 'Could not create the simulation session.';
        this.starting = false;
        this.cd.markForCheck();
      },
    });
  }

  advanceSession(): void {
    if (!this.session || this.starting || this.advancing || this.session.step === 'signed_and_broadcast') return;
    this.cancelPending();
    const generation = this.generation, sessionId = this.session.session_id;
    this.errorMessage = null;
    this.advancing = true;
    this.pending = this.api.advancePlaygroundSession$(sessionId).pipe(take(1), timeout(15000)).subscribe({
      next: value => {
        if (generation !== this.generation) return;
        this.advancing = false;
        if (this.validSession(value) && value.session_id === sessionId) this.session = value;
        else this.errorMessage = 'The service returned an unsupported simulation response.';
        this.cd.markForCheck();
      },
      error: () => {
        if (generation !== this.generation) return;
        this.errorMessage = 'Could not advance this simulation session.';
        this.advancing = false;
        this.cd.markForCheck();
      },
    });
  }

  resetSession(): void {
    this.cancelPending();
    this.session = null;
    this.errorMessage = null;
    this.cd.markForCheck();
  }

  ngOnDestroy(): void {
    this.cancelPending();
    this.networkSubscription.unsubscribe();
  }
}
