import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { LightningResilienceApiService } from './lightning-resilience.service';

@Component({
  selector: 'app-lightning-resilience-channel-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4" *ngIf="channel">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Channel Diagnostics: <span class="font-monospace text-info">{{ channel.short_channel_id }}</span></h1>
          <p class="text-muted mb-0">Detailed slot reservation, hold latency distributions, and peer jamming evaluation.</p>
        </div>
        <a routerLink="/lightning/resilience" class="btn btn-outline-secondary btn-sm">Back to Resilience Center</a>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Capacity</div>
            <div class="h3 fw-bold text-light my-1">{{ channel.capacity_sats | number }} sats</div>
            <div class="small text-muted">Max HTLC Slots: {{ channel.htlc_slot_capacity }}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">In-Flight HTLCs</div>
            <div class="h3 fw-bold text-warning my-1">{{ channel.htlc_slots_in_use }} slots</div>
            <div class="small text-danger">Utilization: {{ channel.htlc_slot_utilization_pct }}%</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Held Duration Avg</div>
            <div class="h3 fw-bold text-danger my-1">{{ channel.average_held_duration_seconds }}s</div>
            <div class="small text-muted">Over 60s holds: {{ channel.held_htlcs_count_over_60s }}</div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Channel Endpoints & Policy Protections</h5>
        </div>
        <div class="card-body">
          <dl class="row mb-0">
            <dt class="col-sm-3 text-muted">Node 1 Public Key</dt>
            <dd class="col-sm-9 font-monospace">
              <a [routerLink]="['/lightning/resilience/node', channel.node_1_pubkey]" class="text-info">{{ channel.node_1_pubkey }}</a>
            </dd>

            <dt class="col-sm-3 text-muted">Node 2 Public Key</dt>
            <dd class="col-sm-9 font-monospace">
              <a [routerLink]="['/lightning/resilience/node', channel.node_2_pubkey]" class="text-info">{{ channel.node_2_pubkey }}</a>
            </dd>

            <dt class="col-sm-3 text-muted">Resilience Band</dt>
            <dd class="col-sm-9"><span class="badge bg-danger">{{ channel.resilience_band }}</span></dd>

            <dt class="col-sm-3 text-muted">Reputation Rate Limiting</dt>
            <dd class="col-sm-9">
              <span class="badge" [ngClass]="channel.reputation_rate_limiting_active ? 'bg-success' : 'bg-secondary'">
                {{ channel.reputation_rate_limiting_active ? 'ACTIVE' : 'INACTIVE' }}
              </span>
            </dd>

            <dt class="col-sm-3 text-muted">Fast-Lane Priority Reserve</dt>
            <dd class="col-sm-9">
              <span class="badge" [ngClass]="channel.fast_lane_available ? 'bg-success' : 'bg-secondary'">
                {{ channel.fast_lane_available ? 'ENABLED' : 'DISABLED' }}
              </span>
            </dd>

            <dt class="col-sm-3 text-muted">Last Updated</dt>
            <dd class="col-sm-9 font-monospace text-muted">{{ channel.updated_at }}</dd>
          </dl>
        </div>
      </div>
    </div>
  `
})
export class LightningResilienceChannelDetailComponent implements OnInit {
  public channel: any = null;

  constructor(
    private route: ActivatedRoute,
    private api: LightningResilienceApiService
  ) {}

  public ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const shortId = params.get('shortId') || '864190x304x2';
      this.api.getChannel$(shortId).subscribe(ch => {
        this.channel = ch;
      });
    });
  }
}
