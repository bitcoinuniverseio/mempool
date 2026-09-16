import { Subscription } from 'rxjs';
import { publicIdentifier, publicOutpoint, validExposure, validPlan } from './quantum-validation';
import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { QuantumApiService, QuantumMigrationPlanResult } from './quantum.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-quantum-migration',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Noncustodial Quantum Migration Planner</h1>
          <span class="badge bg-primary">Hash-Protected Target Standard</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Request a source-reported plan for P2WPKH outputs. Public outpoints are sent to the configured server. A plan does not execute a migration or establish quantum resistance.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/intelligence/quantum' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/intelligence/quantum/exposure' | relativeUrl">Script Cohorts</a>
          <a class="nav-link" [routerLink]="'/intelligence/quantum/history' | relativeUrl">Reveal Timeline</a>
          <a class="nav-link" [routerLink]="'/intelligence/quantum/audit' | relativeUrl">Public Audit</a>
          <a class="nav-link active" [routerLink]="'/intelligence/quantum/migration' | relativeUrl">Migration Planner</a>
        </nav>
      </header>

      <!-- Migration Input Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Configure Migration Plan</h2>
        <form (ngSubmit)="generatePlan()" #planForm="ngForm">
          <div class="mb-3">
            <label for="outpointsInput" class="form-label small text-muted">Exposed Outpoints (one per line, txid:vout)</label>
            <textarea
              id="outpointsInput"
              class="form-control font-monospace"
              rows="3"
              placeholder="e.g. 4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b:0"
              [(ngModel)]="rawOutpoints"
              (ngModelChange)="clear()"
              name="rawOutpoints"
              required
              [disabled]="planning"
            ></textarea>
          </div>

          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <button
              type="button"
              class="btn btn-outline-secondary"
              (click)="loadDemoOutpoints()"
            >
              Load Sample Exposed Outpoint
            </button>
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="planning || !rawOutpoints"
            >
              <span *ngIf="planning" class="spinner-border spinner-border-sm me-1" role="status"></span>
              {{ planning ? 'Synthesizing Plan...' : 'Generate Migration Plan' }}
            </button>
          </div>
        </form>
      </div>

      <div *ngIf="errorMessage" class="alert alert-danger mb-4" role="alert">
        {{ errorMessage }}
      </div>

      <!-- Result View -->
      <div *ngIf="result" class="card p-4 bg-body-tertiary border">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 border-bottom pb-2">
          <h2 class="h5 m-0 text-success">Source-Reported Migration Plan</h2>
          <span class="badge bg-success">{{ result.post_migration_exposure_percentage }}% Projected Exposure (Source Estimate)</span>
        </div>

        <div class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-md-4">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Total Value to Migrate</div>
              <div class="h4 my-1 text-primary">{{ (result.total_exposed_sats / 100000000).toFixed(4) }} BTC</div>
              <div class="small text-muted">{{ result.total_exposed_sats | number }} satoshis</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-4">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Recommended Sweeps</div>
              <div class="h4 my-1 text-secondary">{{ result.recommended_transactions_count }} Transactions</div>
              <div class="small text-muted">Batched for fee minimization</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-4">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Estimated Mining Fee</div>
              <div class="h4 my-1 text-info">{{ result.estimated_migration_fee_sats | number }} sats</div>
              <div class="small text-muted">Standard mempool priority</div>
            </div>
          </div>
        </div>

        <h3 class="h6 mb-3">Step-by-Step Remediation Sequence</h3>
        <div class="d-flex flex-column gap-3">
          <div *ngFor="let s of result.steps" class="p-3 border rounded bg-body">
            <div class="fw-bold mb-1 text-primary">Step {{ s.step_number }}: {{ s.action }}</div>
            <div class="small text-muted">{{ s.description }}</div>
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
export class QuantumMigrationComponent implements OnDestroy {
  private request?: Subscription;
  private networkSubscription?: Subscription;
  rawOutpoints = '';
  planning = false;
  errorMessage: string | null = null;
  result: QuantumMigrationPlanResult | null = null;

  constructor(
    private api: QuantumApiService,
    private cd: ChangeDetectorRef
  ) {
    this.networkSubscription = this.api.networkChanged$?.subscribe(() => { this.clear(); this.cd.markForCheck(); });
  }

  clear(): void {
    this.request?.unsubscribe();
    this.planning = false;
    this.result = null;
    this.errorMessage = null;
  }

  ngOnDestroy(): void { this.networkSubscription?.unsubscribe(); this.clear(); }

  loadDemoOutpoints(): void {
    this.clear();
    this.rawOutpoints = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b:0';
  }

  generatePlan(): void {
    this.clear();
    const input = this.rawOutpoints.trim();
    const outpoints = input.split('\n').map(value => value.trim()).filter(Boolean);
    if (!outpoints.length || outpoints.length > 100 || !outpoints.every(publicOutpoint) || new Set(outpoints.map(value => value.toLowerCase())).size !== outpoints.length) {
      this.errorMessage = 'Enter 1–100 unique public txid:vout outpoints. Nothing was sent.'; return;
    }
    this.planning = true;
    this.request = this.api.generateMigrationPlan$(outpoints).subscribe({
      next: res => {
        if (validPlan(res)) this.result = res;
        else this.errorMessage = 'The source returned malformed or inconsistent evidence.';
        this.planning = false;
        this.cd.markForCheck();
      },
      error: err => {
        this.errorMessage = loadFailureMessage(classifyLoadFailure(err));
        this.planning = false;
        this.cd.markForCheck();
      },
    });
  }
}
