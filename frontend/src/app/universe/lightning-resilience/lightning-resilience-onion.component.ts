import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LightningResilienceApiService, LightningResilienceOverview } from './lightning-resilience.service';

@Component({
  selector: 'app-lightning-resilience-onion',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Onion Messaging Queue & DoS Protection</h1>
          <p class="text-muted mb-0">Hop-by-hop packet processing rates, queue utilization, and token-bucket throttling status.</p>
        </div>
        <a routerLink="/lightning/resilience" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-3 mb-4" *ngIf="overview">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3">
            <div class="text-muted small text-uppercase">Queue Depth</div>
            <div class="display-6 fw-bold text-info my-1">{{ overview.onion_queue.total_queue_depth }} msgs</div>
            <div class="small text-muted">In-memory buffer capacity: 500</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3">
            <div class="text-muted small text-uppercase">Queue Utilization</div>
            <div class="display-6 fw-bold text-success my-1">{{ overview.onion_queue.queue_utilization_pct }}%</div>
            <div class="small text-muted">Healthy threshold: &lt; 60%</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3">
            <div class="text-muted small text-uppercase">Processing Rate</div>
            <div class="display-6 fw-bold text-primary my-1">{{ overview.onion_queue.processing_rate_msgs_per_sec }}/s</div>
            <div class="small text-muted">Sustained throughput</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3">
            <div class="text-muted small text-uppercase">Dropped Packet Rate</div>
            <div class="display-6 fw-bold text-success my-1">{{ overview.onion_queue.dropped_msgs_rate_pct }}%</div>
            <div class="small text-muted">Rate limit active: {{ overview.onion_queue.rate_limit_active ? 'YES' : 'NO' }}</div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Onion Message Anti-Spam Strategy</h5>
        </div>
        <div class="card-body">
          <div class="row">
            <div class="col-md-6">
              <h6>Decentralized Rate Limiting Policy</h6>
              <p class="text-muted small">
                Nodes enforce local token buckets for blinded onion message forwarding. Any peer flooding unendorsed messages
                experiences exponential token depletion, preventing message amplification attacks while preserving genuine payment communications.
              </p>
            </div>
            <div class="col-md-6">
              <h6>Route Blinding Protection</h6>
              <p class="text-muted small">
                Blind route hops prevent intermediaries from identifying the sender or recipient, while maintaining cryptographic
                invariants so malicious intermediate nodes cannot tamper with onion frames without detection.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class LightningResilienceOnionComponent implements OnInit {
  public overview: LightningResilienceOverview | null = null;

  constructor(private api: LightningResilienceApiService) {}

  public ngOnInit(): void {
    this.api.getOverview$().subscribe(res => {
      this.overview = res;
    });
  }
}
