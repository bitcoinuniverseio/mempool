import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { LightningResilienceApiService } from './lightning-resilience.service';

@Component({
  selector: 'app-lightning-resilience-node-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4" *ngIf="node">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Node Resilience Profile: <span class="text-info">{{ node.alias }}</span></h1>
          <p class="text-muted mb-0">Hop defense configurations, circuit breakers, and peer reputation posture.</p>
        </div>
        <a routerLink="/lightning/resilience" class="btn btn-outline-secondary btn-sm">Back to Resilience Center</a>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Overall Health Score</div>
            <div class="display-6 fw-bold text-success my-1">{{ node.overall_health_score }} / 100</div>
            <div class="small text-muted">{{ node.healthy_channels }} of {{ node.total_channels }} channels healthy</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Circuit Breakers</div>
            <div class="h3 fw-bold text-info my-1">{{ node.circuit_breaker_enabled ? 'Active' : 'Disabled' }}</div>
            <div class="small text-muted">Automated temporary peer pausing</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Reputation Policy</div>
            <div class="h3 fw-bold text-primary my-1">{{ node.reputation_policy_enabled ? 'Enforced' : 'Off' }}</div>
            <div class="small text-muted">Upstream/downstream endorsement scheme</div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Node Cryptographic Identity</h5>
        </div>
        <div class="card-body">
          <div class="mb-3">
            <label class="form-label text-muted small text-uppercase">Public Key</label>
            <div class="p-2 bg-black rounded font-monospace small text-light">{{ node.public_key }}</div>
          </div>
          <div class="row">
            <div class="col-md-6">
              <div class="small text-muted">Total Channels: {{ node.total_channels }}</div>
              <div class="small text-muted">Congested Channels: {{ node.congested_channels }}</div>
            </div>
            <div class="col-md-6">
              <div class="small text-muted">Onion Rate Limiting: {{ node.onion_rate_limiting_enabled ? 'Enabled' : 'Disabled' }}</div>
              <div class="small text-muted">Telemetry Updated: {{ node.updated_at }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class LightningResilienceNodeDetailComponent implements OnInit {
  public node: any = null;

  constructor(
    private route: ActivatedRoute,
    private api: LightningResilienceApiService
  ) {}

  public ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const pubkey = params.get('publicKey') || '028b9c2a4f6d8e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b';
      this.api.getNode$(pubkey).subscribe(node => {
        this.node = node;
      });
    });
  }
}
