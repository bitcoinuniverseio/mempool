import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { QuantumApiService, QuantumCohortBreakdown } from './quantum.service';

@Component({
  selector: 'app-quantum-exposure',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">UTXO Script Quantum Exposure Analysis</h1>
          <span class="badge bg-secondary" *ngIf="cohorts.length > 0">
            {{ cohorts.length }} Script Cohorts Evaluated
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Detailed cryptographic comparison of hash-protected vs public key exposed UTXO cohorts under Shor's discrete logarithm attack model.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/intelligence/quantum">Overview</a>
          <a class="nav-link active" routerLink="/intelligence/quantum/exposure">Script Cohorts</a>
          <a class="nav-link" routerLink="/intelligence/quantum/history">Reveal Timeline</a>
          <a class="nav-link" routerLink="/intelligence/quantum/audit">Local Public Audit</a>
          <a class="nav-link" routerLink="/intelligence/quantum/migration">Migration Planner</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Aggregating UTXO script cohorts...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && cohorts.length > 0" class="row g-4 mb-4">
        <div *ngFor="let c of cohorts" class="col-12 col-lg-6">
          <div class="card p-4 h-100 bg-body-tertiary border">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <h2 class="h5 m-0">{{ c.script_type }}</h2>
              <span class="badge" [ngClass]="c.exposed_percentage > 0 ? 'bg-danger' : 'bg-success'">
                {{ c.exposed_percentage > 0 ? 'Exposed' : 'Protected' }}
              </span>
            </div>

            <div class="my-3">
              <div class="d-flex justify-content-between small text-muted mb-1">
                <span>Exposed Proportion</span>
                <span class="fw-semibold">{{ c.exposed_percentage.toFixed(1) }}%</span>
              </div>
              <div class="progress" style="height: 8px;">
                <div class="progress-bar" [ngClass]="c.exposed_percentage > 0 ? 'bg-danger' : 'bg-success'" [style.width.%]="c.exposed_percentage"></div>
              </div>
            </div>

            <div class="row g-2 text-center mt-2">
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Exposed Volume</div>
                  <div class="fw-semibold">{{ (c.exposed_sats / 100000000).toFixed(2) | number }} BTC</div>
                </div>
              </div>
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Total UTXOs</div>
                  <div class="fw-semibold">{{ c.total_utxos | number }}</div>
                </div>
              </div>
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
export class QuantumExposureComponent implements OnInit, OnDestroy {
  cohorts: QuantumCohortBreakdown[] = [];
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: QuantumApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getCohorts$().subscribe({
        next: data => {
          this.cohorts = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load cohorts';
          this.loading = false;
          this.cd.markForCheck();
        },
      })
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
