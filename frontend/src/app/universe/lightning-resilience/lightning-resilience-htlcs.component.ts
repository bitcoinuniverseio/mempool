import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LightningResilienceApiService } from './lightning-resilience.service';

@Component({
  selector: 'app-lightning-resilience-htlcs',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">HTLC / PTLC Slot Pressure & Liquidity Locking</h1>
          <p class="text-muted mb-0">Detailed breakdown of in-flight commitment transaction slots, pending holds, and slow forwarders.</p>
        </div>
        <a routerLink="/lightning/resilience" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Commitment Slot Allocations Across Monitored Channels</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Short Channel ID</th>
                <th>Capacity</th>
                <th>HTLC Max Slots</th>
                <th>In-Flight Slots</th>
                <th>Utilization</th>
                <th>Resilience Tier</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let ch of channels">
                <td>
                  <a [routerLink]="['/lightning/resilience/channel', ch.short_channel_id]" class="text-info font-monospace">
                    {{ ch.short_channel_id }}
                  </a>
                </td>
                <td>{{ ch.capacity_sats | number }} sats</td>
                <td>{{ ch.htlc_slot_capacity }}</td>
                <td>{{ ch.htlc_slots_in_use }}</td>
                <td>
                  <div class="progress" style="height: 14px;">
                    <div class="progress-bar" [ngClass]="ch.htlc_slot_utilization_pct > 70 ? 'bg-danger' : 'bg-success'" [style.width.%]="ch.htlc_slot_utilization_pct">
                      {{ ch.htlc_slot_utilization_pct }}%
                    </div>
                  </div>
                </td>
                <td>
                  <span class="badge" [ngClass]="ch.resilience_band === 'high_congestion' ? 'bg-danger' : 'bg-success'">
                    {{ ch.resilience_band }}
                  </span>
                </td>
                <td>
                  <a [routerLink]="['/lightning/resilience/channel', ch.short_channel_id]" class="btn btn-sm btn-outline-info">Inspect</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class LightningResilienceHtlcsComponent implements OnInit {
  public channels: any[] = [];

  constructor(private api: LightningResilienceApiService) {}

  public ngOnInit(): void {
    this.api.getChannels$().subscribe(res => {
      this.channels = res;
    });
  }
}
