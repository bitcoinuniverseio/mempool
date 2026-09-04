import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BlockPropagationApiService } from './block-propagation.service';

@Component({
  selector: 'app-block-propagation-live',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Live Block Announcement Stream</h1>
          <p class="text-muted mb-0">Real-time p2p gossip observation across geographic listening probe nodes.</p>
        </div>
        <a routerLink="/network/blocks" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="alert alert-info bg-dark border-info d-flex align-items-center mb-4">
        <span class="spinner-grow spinner-grow-sm text-info me-3" role="status"></span>
        <div>Live telemetry stream active across <strong>42 global probe nodes</strong>. Listening for INV and CMPCTBLOCK announcements.</div>
      </div>

      <div class="card bg-dark border-secondary">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Live Propagation Queue</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Height</th>
                <th>Hash</th>
                <th>First Seen Sensor</th>
                <th>T50%</th>
                <th>T90%</th>
                <th>Missing Txs</th>
                <th>FIBRE</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let b of liveData.live_blocks">
                <td class="fw-bold">{{ b.height }}</td>
                <td class="font-monospace text-info">
                  <a [routerLink]="['/network/blocks', b.hash]">{{ b.hash | slice:0:18 }}...</a>
                </td>
                <td><code>{{ b.first_seen_sensor }}</code></td>
                <td class="text-success font-monospace">{{ b.time_to_50_pct_nodes_ms }} ms</td>
                <td class="text-warning font-monospace">{{ b.time_to_90_pct_nodes_ms }} ms</td>
                <td>{{ b.extra_tx_requested_count }}</td>
                <td><span class="badge bg-primary">{{ b.fibre_relayed ? 'YES' : 'NO' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class BlockPropagationLiveComponent implements OnInit {
  public liveData: any = { live_blocks: [] };

  constructor(private api: BlockPropagationApiService) {}

  public ngOnInit(): void {
    this.api.getLive$().subscribe(data => {
      this.liveData = data;
    });
  }
}
