import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { BlockPropagationApiService } from './block-propagation.service';

@Component({
  selector: 'app-block-propagation-block-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4" *ngIf="block">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Block {{ block.height }} Propagation Analysis</h1>
          <p class="text-muted mb-0 font-monospace">{{ block.hash }}</p>
        </div>
        <a routerLink="/network/blocks" class="btn btn-outline-secondary btn-sm">Back to Observatory</a>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Time to 50% Nodes</div>
            <div class="display-6 fw-bold text-success my-1">{{ block.time_to_50_pct_nodes_ms }} ms</div>
            <div class="small text-muted">First seen: {{ block.first_seen_sensor }}</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Time to 90% Nodes</div>
            <div class="display-6 fw-bold text-warning my-1">{{ block.time_to_90_pct_nodes_ms }} ms</div>
            <div class="small text-muted">T99%: {{ block.time_to_99_pct_nodes_ms }} ms</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Transactions & Size</div>
            <div class="display-6 fw-bold text-light my-1">{{ block.tx_count | number }}</div>
            <div class="small text-muted">{{ (block.size_bytes / 1024 / 1024) | number:'1.2-2' }} MB</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Compact Block Status</div>
            <div class="display-6 fw-bold my-1" [ngClass]="block.compact_block_reconstructed ? 'text-success' : 'text-danger'">
              {{ block.compact_block_reconstructed ? 'RECONSTRUCTED' : 'FAILED' }}
            </div>
            <div class="small text-muted">{{ block.extra_tx_requested_count }} roundtrips requested</div>
          </div>
        </div>
      </div>

      <!-- Sensor Latencies -->
      <div class="card bg-dark border-secondary mb-4" *ngIf="block.sensor_latencies">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Regional Sensor First-Arrival Latencies</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Sensor Location</th>
                <th>Arrival Delta</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of block.sensor_latencies">
                <td><code>{{ s.sensor_id }}</code></td>
                <td class="font-monospace text-info">+{{ s.latency_ms }} ms</td>
                <td><span class="badge bg-success">Received</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class BlockPropagationBlockDetailComponent implements OnInit {
  public block: any = null;

  constructor(
    private route: ActivatedRoute,
    private api: BlockPropagationApiService
  ) {}

  public ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const hash = params.get('blockHash') || '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3';
      this.api.getBlock$(hash).subscribe(res => {
        this.block = res;
      });
    });
  }
}
