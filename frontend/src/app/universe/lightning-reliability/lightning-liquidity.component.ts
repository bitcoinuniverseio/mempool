import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LightningReliabilityApiService, LightningLiquiditySimulationResult } from './lightning-reliability.service';

@Component({
  selector: 'app-lightning-liquidity',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Lightning Liquidity Routing Simulator</h1>
          <span class="badge bg-primary">Graph-Based Probability Estimator</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Non-custodial liquidity path simulation estimating multi-hop delivery success and routing fees based on channel capacities.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/lightning/reliability">Reliability Overview</a>
          <a class="nav-link active" routerLink="/lightning/liquidity">Liquidity Simulation</a>
          <a class="nav-link" routerLink="/lightning/lsp">LSP Directory</a>
        </nav>
      </header>

      <!-- Simulation Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Simulate Payment Path Probability</h2>
        <form (ngSubmit)="simulate()" #simForm="ngForm">
          <div class="row g-3">
            <div class="col-12 col-md-8">
              <label for="targetPubkey" class="form-label small text-muted">Destination Node Public Key</label>
              <input
                id="targetPubkey"
                type="text"
                class="form-control font-monospace"
                placeholder="e.g. 03864ef025fde8fb587d989186ce6a4a186895ee44a926bfc370e2c366597a3f8f"
                [(ngModel)]="targetPubkey"
                name="targetPubkey"
                required
                [disabled]="simulating"
              />
            </div>
            <div class="col-12 col-md-4">
              <label for="amountSats" class="form-label small text-muted">Amount (Satoshis)</label>
              <input
                id="amountSats"
                type="number"
                class="form-control font-monospace"
                placeholder="100000"
                [(ngModel)]="amountSats"
                name="amountSats"
                min="1"
                required
                [disabled]="simulating"
              />
            </div>
          </div>

          <div class="d-flex justify-content-end mt-4">
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="simulating || !targetPubkey || !amountSats"
            >
              <span *ngIf="simulating" class="spinner-border spinner-border-sm me-1" role="status"></span>
              {{ simulating ? 'Simulating Path...' : 'Simulate Liquidity' }}
            </button>
          </div>
        </form>
      </div>

      <!-- Error message -->
      <div *ngIf="errorMessage" class="alert alert-danger mb-4" role="alert">
        {{ errorMessage }}
      </div>

      <!-- Result View -->
      <div *ngIf="result" class="card p-4 bg-body-tertiary border">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 border-bottom pb-2">
          <h2 class="h5 m-0 text-primary">Simulation Result</h2>
          <span class="badge" [ngClass]="{
            'bg-success': result.confidence_rating === 'high',
            'bg-warning': result.confidence_rating === 'moderate',
            'bg-danger': result.confidence_rating === 'low'
          }">
            Confidence: {{ result.confidence_rating | titlecase }}
          </span>
        </div>

        <div class="row g-3">
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Estimated Delivery Probability</div>
              <div class="h3 my-1 text-success">{{ (result.estimated_path_probability * 100).toFixed(1) }}%</div>
              <div class="small text-muted">Across public routing channels</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Estimated Routing Fee</div>
              <div class="h3 my-1 text-primary">{{ result.estimated_fee_sats }} sats</div>
              <div class="small text-muted">Median multi-hop baseline</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Minimum Route Hops</div>
              <div class="h3 my-1 text-secondary">{{ result.min_hops }} hops</div>
              <div class="small text-muted">Shortest viable route</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Available Estimated Capacity</div>
              <div class="h3 my-1 text-info">{{ result.available_capacity_estimate_sats | number }} sats</div>
              <div class="small text-muted">Near-destination liquidity</div>
            </div>
          </div>
        </div>
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
export class LightningLiquidityComponent {
  targetPubkey = '03864ef025fde8fb587d989186ce6a4a186895ee44a926bfc370e2c366597a3f8f';
  amountSats = 250000;
  simulating = false;
  errorMessage: string | null = null;
  result: LightningLiquiditySimulationResult | null = null;

  constructor(
    private api: LightningReliabilityApiService,
    private cd: ChangeDetectorRef
  ) {}

  simulate(): void {
    if (!this.targetPubkey || !this.amountSats) return;
    this.simulating = true;
    this.errorMessage = null;
    this.result = null;

    this.api.simulateLiquidity$(this.targetPubkey.trim(), Number(this.amountSats)).subscribe({
      next: res => {
        this.result = res;
        this.simulating = false;
        this.cd.markForCheck();
      },
      error: err => {
        this.errorMessage = err?.error?.error || err?.message || 'Failed to simulate liquidity';
        this.simulating = false;
        this.cd.markForCheck();
      },
    });
  }
}
