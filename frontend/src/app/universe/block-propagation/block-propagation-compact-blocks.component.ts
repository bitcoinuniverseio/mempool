import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BlockPropagationApiService } from './block-propagation.service';

@Component({
  selector: 'app-block-propagation-compact-blocks',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">BIP152 Compact Block Reconstruction Intelligence</h1>
          <p class="text-muted mb-0">Analysis of mempool pre-fill efficiency, short-id collisions, and getblocktxn roundtrips.</p>
        </div>
        <a routerLink="/network/blocks" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Compact Block Reconstruction History</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Height</th>
                <th>Block Hash</th>
                <th>Matched Short IDs</th>
                <th>Missing Txs</th>
                <th>Reconstruction Time</th>
                <th>Hit Rate</th>
                <th>Relay Protocol</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let cb of compactBlocks">
                <td class="fw-bold">{{ cb.block_height }}</td>
                <td class="font-monospace text-info">
                  <a [routerLink]="['/network/blocks', cb.block_hash]">{{ cb.block_hash | slice:0:18 }}...</a>
                </td>
                <td>{{ cb.short_ids_matched | number }}</td>
                <td>
                  <span class="badge" [ngClass]="cb.missing_txs === 0 ? 'bg-success' : 'bg-warning text-dark'">
                    {{ cb.missing_txs }} missing
                  </span>
                </td>
                <td class="font-monospace text-success">{{ cb.reconstruction_time_ms }} ms</td>
                <td>
                  <div class="progress" style="height: 14px;">
                    <div class="progress-bar bg-success" [style.width.%]="cb.hit_rate_pct">
                      {{ cb.hit_rate_pct }}%
                    </div>
                  </div>
                </td>
                <td><span class="badge bg-secondary">{{ cb.method }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class BlockPropagationCompactBlocksComponent implements OnInit {
  public compactBlocks: any[] = [];

  constructor(private api: BlockPropagationApiService) {}

  public ngOnInit(): void {
    this.api.getCompactBlocks$().subscribe(res => {
      this.compactBlocks = res;
    });
  }
}
