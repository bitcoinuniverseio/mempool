import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LightningResilienceApiService, LightningResilienceOverview } from './lightning-resilience.service';

@Component({
  selector: 'app-lightning-resilience-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Lightning HTLC/PTLC Congestion & Jamming Resilience Center</h1>
          <p class="text-muted mb-0">Real-time telemetry on channel slot pressure, liquidity pinning, onion queue depths, and proactive jamming mitigations.</p>
        </div>
        <div class="btn-group">
          <a routerLink="/lightning/resilience/simulate" class="btn btn-outline-primary btn-sm">Jamming Simulator</a>
          <a routerLink="/lightning/resilience/mitigations" class="btn btn-primary btn-sm">Mitigations Matrix</a>
        </div>
      </div>

      <!-- Nav Tabs -->
      <ul class="nav nav-tabs mb-4">
        <li class="nav-item">
          <a class="nav-link active" routerLink="/lightning/resilience">Overview</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/lightning/resilience/htlcs">HTLC Slot Allocation</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/lightning/resilience/onion-messages">Onion Messaging Queue</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/lightning/resilience/simulate">Simulation Engine</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/lightning/resilience/mitigations">Defensive Mitigations</a>
        </li>
      </ul>

      <!-- Metric Cards -->
      <div class="row g-3 mb-4" *ngIf="overview">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary h-100 p-3">
            <div class="text-muted small text-uppercase fw-semibold">Monitored Channels</div>
            <div class="display-6 fw-bold my-1 text-info">{{ overview.total_channels_monitored }}</div>
            <div class="small text-success">{{ overview.healthy_channels_count }} Normal / {{ overview.congested_channels_count }} Congested</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary h-100 p-3">
            <div class="text-muted small text-uppercase fw-semibold">Avg Slot Utilization</div>
            <div class="display-6 fw-bold my-1 text-warning">{{ overview.average_slot_utilization_pct }}%</div>
            <div class="small text-muted">Across all tracked routing nodes</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary h-100 p-3">
            <div class="text-muted small text-uppercase fw-semibold">P95 Hold Duration</div>
            <div class="display-6 fw-bold my-1 text-light">{{ overview.average_held_duration_p95_seconds }}s</div>
            <div class="small text-muted">Normal baseline: &lt; 15s</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary h-100 p-3">
            <div class="text-muted small text-uppercase fw-semibold">Active Incidents</div>
            <div class="display-6 fw-bold my-1" [ngClass]="overview.active_incidents_count > 0 ? 'text-danger' : 'text-success'">
              {{ overview.active_incidents_count }}
            </div>
            <div class="small text-muted">Automated mitigation triggers</div>
          </div>
        </div>
      </div>

      <!-- Top Congested Channels -->
      <div class="card bg-dark border-secondary mb-4" *ngIf="overview">
        <div class="card-header border-secondary d-flex justify-content-between align-items-center">
          <h5 class="card-title mb-0">High-Pressure & Congested Channels</h5>
          <span class="badge bg-warning text-dark">{{ overview.top_congested_channels.length }} High Priority</span>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Short Channel ID</th>
                <th>Capacity (sats)</th>
                <th>HTLC Slots (Used / Cap)</th>
                <th>Utilization</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let ch of overview.top_congested_channels">
                <td>
                  <a [routerLink]="['/lightning/resilience/channel', ch.short_channel_id]" class="text-info font-monospace">
                    {{ ch.short_channel_id }}
                  </a>
                </td>
                <td>{{ ch.capacity_sats | number }}</td>
                <td>{{ ch.htlc_slots_in_use }} / {{ ch.htlc_slot_capacity }}</td>
                <td>
                  <div class="progress" style="height: 16px;">
                    <div class="progress-bar bg-danger" role="progressbar" [style.width.%]="ch.htlc_slot_utilization_pct">
                      {{ ch.htlc_slot_utilization_pct }}%
                    </div>
                  </div>
                </td>
                <td>
                  <span class="badge bg-danger">{{ ch.resilience_band }}</span>
                </td>
                <td>
                  <a [routerLink]="['/lightning/resilience/channel', ch.short_channel_id]" class="btn btn-outline-info btn-sm">Inspect Channel</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recent Incidents -->
      <div class="card bg-dark border-secondary mb-4" *ngIf="overview">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Active Telemetry Alerts & Jamming Signals</h5>
        </div>
        <div class="card-body">
          <div *ngFor="let inc of overview.recent_incidents" class="alert alert-danger bg-dark border-danger mb-3">
            <div class="d-flex justify-content-between">
              <strong>Incident {{ inc.incident_id }}: {{ inc.incident_type }}</strong>
              <span class="badge bg-danger">{{ inc.severity | uppercase }}</span>
            </div>
            <p class="mb-1 mt-2">{{ inc.description }}</p>
            <div class="small text-muted mb-2">Channel: <code>{{ inc.channel_short_id }}</code> | Value: {{ inc.observed_value }}% (Threshold: {{ inc.threshold_value }}%)</div>
            <div class="small text-warning">Recommendation: {{ inc.operator_recommendation }}</div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class LightningResilienceOverviewComponent implements OnInit {
  public overview: LightningResilienceOverview | null = null;

  constructor(private api: LightningResilienceApiService) {}

  public ngOnInit(): void {
    this.api.getOverview$().subscribe(res => {
      this.overview = res;
    });
  }
}
