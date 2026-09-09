import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { OpenTimestampsApiService, TimestampCalendar } from './opentimestamps.service';

/**
 * The allowlisted calendars, as this deployment last observed them. A
 * calendar's own queue is not visible through its protocol, so the page shows
 * what was observed: reachability, and the proofs stamped here it anchored.
 */
@Component({
  selector: 'app-opentimestamps-calendars',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Calendars</h1>
          <p class="text-muted mb-0">The calendar servers this deployment submits digests to.</p>
        </div>
        <a routerLink="/tools/timestamp" class="btn btn-outline-secondary btn-sm">Overview</a>
      </div>

      <div class="alert alert-warning" role="alert" *ngIf="loadError">{{ loadError }}</div>
      <p class="text-muted" *ngIf="loading" role="status">Loading</p>

      <div class="card" *ngIf="!loading && !loadError">
        <p class="text-muted p-3 mb-0" *ngIf="!calendars.length">No calendar is configured.</p>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Calendar servers, scroll horizontally" i18n-aria-label *ngIf="calendars.length">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Calendar</th>
                <th>Status</th>
                <th>Anchored here</th>
                <th>Latest block</th>
                <th>Last observed</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of calendars">
                <td>
                  <div class="fw-bold">{{ c.name }}</div>
                  <div class="small text-muted font-monospace text-break">{{ c.url }}</div>
                </td>
                <td>
                  <span class="badge" [class.badge-success]="c.health_status === 'online'" [class.badge-warning]="c.health_status === 'degraded'" [class.badge-offline]="c.health_status === 'offline'" [title]="c.health_detail">
                    {{ c.health_status | uppercase }}
                  </span>
                </td>
                <td>{{ c.anchored_proofs_count | number }}</td>
                <td class="fw-bold">{{ c.last_anchor_block_height ?? 'none yet' }}</td>
                <td class="small text-muted">{{ c.health_observed_at ? (c.health_observed_at | date:'short') : 'not yet' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .badge-offline { color: #fff; background: var(--u-state-unavailable, #c0392b); }
  `],
})
export class OpenTimestampsCalendarsComponent implements OnInit {
  public calendars: TimestampCalendar[] = [];
  public loadError: string | null = null;
  public loading = true;

  constructor(private api: OpenTimestampsApiService) {}

  public ngOnInit(): void {
    this.api.getCalendars$().subscribe({
      next: res => {
        this.calendars = res ?? [];
        this.loadError = null;
        this.loading = false;
      },
      error: err => {
        this.calendars = [];
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
        this.loading = false;
      },
    });
  }
}
