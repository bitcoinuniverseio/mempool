import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { DlcApiService, DlcOracle } from './dlc.service';

@Component({
  selector: 'app-dlc-oracles',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Registered DLC Oracles</h1>
          <span class="badge bg-secondary" *ngIf="oracles.length > 0">
            {{ oracles.length }} Oracles
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Oracle endpoint directory, health telemetry, public keys, and cryptographic attestation reliability records.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/contracts/dlc">Overview</a>
          <a class="nav-link active" routerLink="/contracts/dlc/oracles">Oracles</a>
          <a class="nav-link" routerLink="/contracts/dlc/events">Events</a>
          <a class="nav-link" routerLink="/contracts/dlc/inspect">Contract Inspector</a>
          <a class="nav-link" routerLink="/contracts/dlc/simulate">Regtest Simulator</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading oracle registry...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && oracles.length > 0" class="row g-4">
        <div *ngFor="let o of oracles" class="col-12 col-lg-6">
          <div class="card p-4 h-100 bg-body-tertiary border">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div>
                <span class="badge bg-info text-dark me-1">{{ o.endpoint_type }}</span>
                <span class="badge bg-secondary">{{ o.protocol_revision }}</span>
                <h2 class="h5 mt-2 mb-1">{{ o.display_name }}</h2>
                <div class="small font-monospace text-muted text-break">{{ o.oracle_public_key }}</div>
              </div>
              <span class="badge" [ngClass]="o.health === 'healthy' ? 'bg-success' : 'bg-warning text-dark'">
                {{ o.health | uppercase }}
              </span>
            </div>

            <div class="row g-2 my-3">
              <div class="col-4">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Announcements</div>
                  <div class="fw-bold">{{ o.coverage.total_announcements }}</div>
                </div>
              </div>
              <div class="col-4">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Attestations</div>
                  <div class="fw-bold">{{ o.coverage.total_attestations }}</div>
                </div>
              </div>
              <div class="col-4">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Conflicts</div>
                  <div class="fw-bold" [ngClass]="o.coverage.conflicts_detected > 0 ? 'text-danger' : 'text-success'">
                    {{ o.coverage.conflicts_detected }}
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-auto pt-3 border-top d-flex justify-content-between align-items-center">
              <span class="small text-muted font-monospace text-break">{{ o.endpoint }}</span>
              <a [routerLink]="['/contracts/dlc/oracle', o.oracle_id]" class="btn btn-sm btn-outline-primary">
                Inspect Oracle
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class DlcOraclesComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  oracles: DlcOracle[] = [];
  private sub?: Subscription;

  constructor(private dlcApi: DlcApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.sub = this.dlcApi.getOracles$().subscribe({
      next: (data) => {
        this.oracles = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load oracles';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
