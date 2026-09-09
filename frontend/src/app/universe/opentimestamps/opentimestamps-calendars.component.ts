import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { OpenTimestampsApiService } from './opentimestamps.service';

@Component({
  selector: 'app-opentimestamps-calendars',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="alert alert-warning" role="alert" *ngIf="loadError">
        {{ loadError }}
      </div>
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">OpenTimestamps Calendar Servers</h1>
          <p class="text-muted mb-0">Decentralized calendar aggregation network uptime, pending commitments, and synchronization status.</p>
        </div>
        <a routerLink="/tools/timestamp" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Active Public Calendar Servers</h5>
        </div>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Active Public Calendar Servers, scroll horizontally" i18n-aria-label>
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Calendar ID</th>
                <th>Endpoint URL</th>
                <th>Proofs anchored here</th>
                <th>Latest anchored block</th>
                <th>Last observation</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of calendars">
                <td class="fw-bold text-info">{{ c.calendar_id }}</td>
                <td class="font-monospace text-muted">{{ c.url }}</td>
                <td>{{ c.anchored_proofs_count }}</td>
                <td class="fw-bold">{{ c.last_anchor_block_height ?? 'none yet' }}</td>
                <td class="text-muted small">{{ c.health_detail }}</td>
                <td><span class="badge" [class.bg-success]="c.health_status === 'online'" [class.bg-warning]="c.health_status === 'degraded'" [class.bg-danger]="c.health_status === 'offline'">{{ c.health_status | uppercase }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class OpenTimestampsCalendarsComponent implements OnInit {
  public calendars: any[] = [];
  public loadError: string | null = null;

  constructor(private api: OpenTimestampsApiService) {}

  public ngOnInit(): void {
    this.api.getCalendars$().subscribe({
      next: res => {
        this.calendars = res ?? [];
        this.loadError = null;
      },
      error: err => {
        this.calendars = [];
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
      },
    });
  }
}
