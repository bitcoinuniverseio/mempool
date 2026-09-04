import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { OpenTimestampsApiService } from './opentimestamps.service';

@Component({
  selector: 'app-opentimestamps-calendars',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
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
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Calendar ID</th>
                <th>Endpoint URL</th>
                <th>Pending Commitments</th>
                <th>Latest Anchored Block</th>
                <th>Uptime</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of calendars">
                <td class="fw-bold text-info">{{ c.calendar_id }}</td>
                <td class="font-monospace text-muted">{{ c.url }}</td>
                <td>{{ c.pending_commitments }} hashes</td>
                <td class="fw-bold">{{ c.last_btc_block_anchored }}</td>
                <td class="text-success">{{ c.uptime_pct }}%</td>
                <td><span class="badge bg-success">{{ c.status | uppercase }}</span></td>
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

  constructor(private api: OpenTimestampsApiService) {}

  public ngOnInit(): void {
    this.api.getCalendars$().subscribe(res => {
      this.calendars = res;
    });
  }
}
