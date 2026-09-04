import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BlockPropagationApiService } from './block-propagation.service';

@Component({
  selector: 'app-block-propagation-fibre',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">FIBRE (Fast Internet Bitcoin Relay Engine) Relay Status</h1>
          <p class="text-muted mb-0">High-speed UDP relay network telemetry with forward error correction (FEC).</p>
        </div>
        <a routerLink="/network/blocks" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-3 mb-4" *ngIf="fibre">
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Active Relay Nodes</div>
            <div class="display-6 fw-bold text-primary my-1">{{ fibre.active_nodes }}</div>
            <div class="small text-muted">Dedicated low-latency backbones</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Mean Relay Latency</div>
            <div class="display-6 fw-bold text-success my-1">{{ fibre.average_latency_ms }} ms</div>
            <div class="small text-muted">Transcontinental optical paths</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Bandwidth Compression</div>
            <div class="display-6 fw-bold text-info my-1">{{ fibre.bandwidth_reduction_pct }}%</div>
            <div class="small text-muted">FEC parity chunks active</div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary mb-4" *ngIf="fibre">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">FIBRE Node Mesh Status</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Location Hub</th>
                <th>Ping Latency</th>
                <th>Sync Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let n of fibre.nodes">
                <td class="fw-bold">{{ n.location }}</td>
                <td class="font-monospace text-success">{{ n.ping_ms }} ms</td>
                <td><span class="badge bg-success">{{ n.status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class BlockPropagationFibreComponent implements OnInit {
  public fibre: any = null;

  constructor(private api: BlockPropagationApiService) {}

  public ngOnInit(): void {
    this.api.getFibre$().subscribe(res => {
      this.fibre = res;
    });
  }
}
