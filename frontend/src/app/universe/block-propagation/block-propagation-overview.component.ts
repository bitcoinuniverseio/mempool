import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BlockPropagationApiService, BlockPropagationOverview } from './block-propagation.service';

@Component({
  selector: 'app-block-propagation-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Block Propagation & Compact-Block Observatory</h1>
          <p class="text-muted mb-0">Global telemetry on block announcement speed, FIBRE relays, compact-block reconstruction, and fork races.</p>
        </div>
        <div class="btn-group">
          <a routerLink="/network/blocks/live" class="btn btn-outline-primary btn-sm">Live Stream</a>
          <a routerLink="/network/fork-races" class="btn btn-primary btn-sm">Fork Races</a>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <ul class="nav nav-tabs mb-4">
        <li class="nav-item">
          <a class="nav-link active" routerLink="/network/blocks">Overview</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/network/blocks/live">Live Propagation</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/network/compact-blocks">Compact Blocks (BIP152)</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/network/fork-races">Fork Races</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/network/stale-tips">Stale Tips</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/network/fibre">FIBRE Relay Network</a>
        </li>
      </ul>

      <!-- Metric Cards -->
      <div class="row g-3 mb-4" *ngIf="overview">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase fw-semibold">Avg Propagation</div>
            <div class="display-6 fw-bold my-1 text-info">{{ overview.average_propagation_time_ms }} ms</div>
            <div class="small text-muted">Global 50% node threshold</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase fw-semibold">P90 Propagation</div>
            <div class="display-6 fw-bold my-1 text-warning">{{ overview.p90_propagation_time_ms }} ms</div>
            <div class="small text-muted">P99: {{ overview.p99_propagation_time_ms }} ms</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase fw-semibold">Compact Block Hit Rate</div>
            <div class="display-6 fw-bold my-1 text-success">{{ overview.compact_block_hit_rate_pct }}%</div>
            <div class="small text-muted">Mempool pre-fill efficiency</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase fw-semibold">Active Sensors</div>
            <div class="display-6 fw-bold my-1 text-primary">{{ overview.active_sensors_count }}</div>
            <div class="small text-muted">Global listening fleet</div>
          </div>
        </div>
      </div>

      <!-- Recent Blocks Table -->
      <div class="card bg-dark border-secondary mb-4" *ngIf="overview">
        <div class="card-header border-secondary d-flex justify-content-between align-items-center">
          <h5 class="card-title mb-0">Recent Block Propagation Events</h5>
          <span class="badge bg-secondary">{{ overview.recent_blocks.length }} Blocks</span>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Height</th>
                <th>Hash</th>
                <th>Miner</th>
                <th>Txs</th>
                <th>T50% (ms)</th>
                <th>T90% (ms)</th>
                <th>Compact Hit</th>
                <th>FIBRE</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let b of overview.recent_blocks">
                <td class="fw-bold">{{ b.height }}</td>
                <td class="font-monospace">
                  <a [routerLink]="['/network/blocks', b.hash]" class="text-info">{{ b.hash | slice:0:16 }}...</a>
                </td>
                <td><span class="badge bg-secondary">{{ b.miner }}</span></td>
                <td>{{ b.tx_count | number }}</td>
                <td class="text-success font-monospace">{{ b.time_to_50_pct_nodes_ms }}</td>
                <td class="text-warning font-monospace">{{ b.time_to_90_pct_nodes_ms }}</td>
                <td>
                  <span class="badge" [ngClass]="b.compact_block_reconstructed ? 'bg-success' : 'bg-danger'">
                    {{ b.compact_block_reconstructed ? 'HIT' : 'MISS' }}
                  </span>
                </td>
                <td>
                  <span class="badge" [ngClass]="b.fibre_relayed ? 'bg-primary' : 'bg-dark'">
                    {{ b.fibre_relayed ? 'YES' : 'NO' }}
                  </span>
                </td>
                <td>
                  <a [routerLink]="['/network/blocks', b.hash]" class="btn btn-outline-info btn-sm">Inspect</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class BlockPropagationOverviewComponent implements OnInit {
  public overview: BlockPropagationOverview | null = null;

  constructor(private api: BlockPropagationApiService) {}

  public ngOnInit(): void {
    this.api.getOverview$().subscribe(res => {
      this.overview = res;
    });
  }
}
