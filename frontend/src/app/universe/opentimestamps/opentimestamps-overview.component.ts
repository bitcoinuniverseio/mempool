import { Subscription } from 'rxjs';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { OpenTimestampsApiService, TimestampsOverview } from './opentimestamps.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/**
 * The timestamps overview. Every figure is this deployment's own record: the
 * digests stamped here, how many of them a calendar has anchored in Bitcoin,
 * and which allowlisted calendars answered when last asked.
 */
@Component({
  selector: 'app-opentimestamps-overview',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">OpenTimestamps</h1>
          <p class="text-muted mb-0">Anchor a document digest in Bitcoin and verify a proof.</p>
        </div>
        <div class="d-flex gap-2">
          <a [routerLink]="'/tools/timestamp/stamp' | relativeUrl" class="btn btn-primary btn-sm">Stamp a digest</a>
          <a [routerLink]="'/tools/timestamp/verify' | relativeUrl" class="btn btn-outline-primary btn-sm">Verify a proof</a>
        </div>
      </div>

      <nav class="nav nav-tabs mb-4" aria-label="Timestamp pages">
        <a class="nav-link active" [routerLink]="'/tools/timestamp' | relativeUrl" aria-current="page">Overview</a>
        <a class="nav-link" [routerLink]="'/tools/timestamp/stamp' | relativeUrl">Stamp</a>
        <a class="nav-link" [routerLink]="'/tools/timestamp/verify' | relativeUrl">Verify</a>
        <a class="nav-link" [routerLink]="'/intelligence/timestamps/calendars' | relativeUrl">Calendars</a>
        <a class="nav-link" [routerLink]="'/intelligence/timestamps/batches' | relativeUrl">Anchors</a>
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

        <p class="small" *ngIf="overview.active_chain_coverage as coverage">Owned-chain readback: {{ coverage.records_examined }} stored records examined (limit {{ coverage.record_limit }}). {{ coverage.complete ? 'Complete stored anchor window.' : 'Partial coverage; full current count is unknown.' }} Historical stored anchors: {{ overview.stored_anchored_proofs }}.</p>
        <div class="row g-3 mb-4">
          <div class="col-6 col-md-3">
            <div class="card p-3 h-100">
              <div class="text-muted small text-uppercase">Stamped here</div>
              <div class="display-6 fw-bold my-1">{{ overview.total_proofs_tracked | number }}</div>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="card p-3 h-100">
              <div class="text-muted small text-uppercase">Current chain verified</div>
              <div class="display-6 fw-bold my-1">{{ overview.bitcoin_confirmed_proofs === null ? 'Unknown' : (overview.bitcoin_confirmed_proofs | number) }}</div>
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
              <div class="display-6 fw-bold my-1">{{ overview.latest_anchored_block_height ?? 'not established' }}</div>
              <div class="small text-muted">{{ overview.active_calendar_servers }} calendar{{ overview.active_calendar_servers === 1 ? '' : 's' }} online</div>
            </div>
          </div>
        </div>

        <div class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h2 class="h5 mb-0">Recent anchors</h2>
            <a [routerLink]="'/intelligence/timestamps/batches' | relativeUrl" class="small">All anchors</a>
          </div>
          <p class="text-muted p-3 mb-0" *ngIf="!overview.recent_anchors?.length">No current anchor was verified in the observed record window.</p>
          <div class="table-responsive" tabindex="0" role="region" aria-label="Recent anchors, scroll horizontally" i18n-aria-label *ngIf="overview.recent_anchors?.length">
            <table class="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Calendar</th>
                  <th>Block</th>
                  <th>Proofs</th>
                  <th>Bitcoin header Merkle root</th>
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
export class OpenTimestampsOverviewComponent implements OnInit, OnDestroy {
  private subscription?: Subscription;
  public ngOnDestroy(): void { this.subscription?.unsubscribe(); }
  public overview: TimestampsOverview | null = null;
  public loadError: string | null = null;
  public loading = true;

  constructor(private api: OpenTimestampsApiService) {}

  public ngOnInit(): void {
    this.subscription = this.api.watch(() => this.api.getOverview$()).subscribe(state => {
      this.loading = state.loading;
      this.loadError = state.error ? loadFailureMessage(classifyLoadFailure(state.error)) : null;
      this.overview = state.value;

    });
  }
}
