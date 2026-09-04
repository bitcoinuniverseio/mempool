import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BlockPropagationApiService } from './block-propagation.service';

@Component({
  selector: 'app-block-propagation-stale-tips',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Stale Tips & 1-Block Reorganizations</h1>
          <p class="text-muted mb-0">Historical log of discarded blocks, miner economic losses, and chain divergence duration.</p>
        </div>
        <a routerLink="/network/blocks" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Stale Tip History</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Height</th>
                <th>Date</th>
                <th>Miner</th>
                <th>Stale Hash</th>
                <th>Surviving Hash</th>
                <th>Lost Rewards</th>
                <th>Reorg Depth</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of staleTips">
                <td class="fw-bold">{{ s.height }}</td>
                <td>{{ s.date }}</td>
                <td><span class="badge bg-secondary">{{ s.miner }}</span></td>
                <td class="font-monospace text-danger">{{ s.stale_hash | slice:0:16 }}...</td>
                <td class="font-monospace text-success">{{ s.winning_hash | slice:0:16 }}...</td>
                <td class="text-warning">{{ ((s.lost_subsidy_sats + s.lost_fees_sats) / 100000000) | number:'1.4-4' }} BTC</td>
                <td><span class="badge bg-warning text-dark">{{ s.reorg_depth }} Block</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class BlockPropagationStaleTipsComponent implements OnInit {
  public staleTips: any[] = [];

  constructor(private api: BlockPropagationApiService) {}

  public ngOnInit(): void {
    this.api.getStaleTips$().subscribe(res => {
      this.staleTips = res;
    });
  }
}
