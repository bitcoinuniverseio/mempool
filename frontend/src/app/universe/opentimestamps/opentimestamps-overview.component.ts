import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { OpenTimestampsApiService, TimestampsOverview } from './opentimestamps.service';

/**
 * The timestamps overview. Every figure is this deployment's own record: the
 * digests stamped here, how many of them a calendar has anchored in Bitcoin,
 * and which allowlisted calendars answered when last asked.
 */
@Component({
  selector: 'app-opentimestamps-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">OpenTimestamps</h1>
          <p class="text-muted mb-0">Anchor a document digest in Bitcoin and verify a proof.</p>
        </div>
        <div class="d-flex gap-2">
          <a routerLink="/tools/timestamp/stamp" class="btn btn-primary btn-sm">Stamp a digest</a>
          <a routerLink="/tools/timestamp/verify" class="btn btn-outline-primary btn-sm">Verify a proof</a>
        </div>
      </div>

      <nav class="nav nav-tabs mb-4" aria-label="Timestamp pages">
        <a class="nav-link active" routerLink="/tools/timestamp" aria-current="page">Overview</a>
        <a class="nav-link" routerLink="/tools/timestamp/stamp">Stamp</a>
        <a class="nav-link" routerLink="/tools/timestamp/verify">Verify</a>
        <a class="nav-link" routerLink="/intelligence/timestamps/calendars">Calendars</a>
        <a class="nav-link" routerLink="/intelligence/timestamps/batches">Anchors</a>
      </nav>

      <div class="alert alert-warning" role="alert" *ngIf="loadError">{{ loadError }}</div>
      <p class="text-muted" *ngIf="loading" role="status">Loading</p>

      <ng-container *ngIf="overview">
        <div class="alert alert-secondary small" role="note" *ngIf="overview.storage === 'memory'">
          Records on this deployment are kept in memory and do not survive a restart.
        </div>
        <div class="alert alert-warning small" role="alert" *ngIf="!overview.calendars_configured">
          No calendar is configured for {{ overview.network }} on this deployment. Stamping is unavailable until the operator names one; verification still works.
        </div>

        <div class="row g-3 mb-4">
          <div class="col-6 col-md-3">
            <div class="card p-3 h-100">
              <div class="text-muted small text-uppercase">Stamped here</div>
              <div class="display-6 fw-bold my-1">{{ overview.total_proofs_tracked | number }}</div>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="card p-3 h-100">
              <div class="text-muted small text-uppercase">Anchored in Bitcoin</div>
              <div class="display-6 fw-bold my-1 metric-proven">{{ overview.bitcoin_confirmed_proofs | number }}</div>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="card p-3 h-100">
              <div class="text-muted small text-uppercase">Waiting for a calendar</div>
              <div class="display-6 fw-bold my-1">{{ overview.pending_calendar_attestations | number }}</div>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="card p-3 h-100">
              <div class="text-muted small text-uppercase">Latest anchor block</div>
              <div class="display-6 fw-bold my-1">{{ overview.latest_anchored_block_height ?? 'none yet' }}</div>
              <div class="small text-muted">{{ overview.active_calendar_servers }} calendar{{ overview.active_calendar_servers === 1 ? '' : 's' }} online</div>
            </div>
          </div>
        </div>

        <div class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h2 class="h5 mb-0">Recent anchors</h2>
            <a routerLink="/intelligence/timestamps/batches" class="small">All anchors</a>
          </div>
          <p class="text-muted p-3 mb-0" *ngIf="!overview.recent_anchors?.length">No proof stamped here has been anchored yet.</p>
          <div class="table-responsive" tabindex="0" role="region" aria-label="Recent anchors, scroll horizontally" i18n-aria-label *ngIf="overview.recent_anchors?.length">
            <table class="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Calendar</th>
                  <th>Block</th>
                  <th>Proofs</th>
                  <th>Commitment</th>
                  <th>Anchored</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let anchor of overview.recent_anchors">
                  <td>{{ anchor.calendar_id }}</td>
                  <td class="fw-bold">{{ anchor.block_height }}</td>
                  <td>{{ anchor.leaf_count | number }}</td>
                  <td class="font-monospace text-muted" [title]="anchor.merkle_root">{{ anchor.merkle_root | slice:0:16 }}&hellip;</td>
                  <td class="small">{{ anchor.anchored_at | date:'short' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    .metric-proven { color: var(--u-state-proven); }
  `],
})
export class OpenTimestampsOverviewComponent implements OnInit {
  public overview: TimestampsOverview | null = null;
  public loadError: string | null = null;
  public loading = true;

  constructor(private api: OpenTimestampsApiService) {}

  public ngOnInit(): void {
    this.api.getOverview$().subscribe({
      next: res => {
        this.overview = res;
        this.loadError = null;
        this.loading = false;
      },
      error: err => {
        this.overview = null;
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
        this.loading = false;
      },
    });
  }
}
