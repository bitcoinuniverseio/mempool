import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { OpenTimestampsApiService } from './opentimestamps.service';

@Component({
  selector: 'app-opentimestamps-batches',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Anchored Batches & Merkle Roots</h1>
          <p class="text-muted mb-0">On-chain Bitcoin OP_RETURN and taproot commitments containing aggregated OTS Merkle roots.</p>
        </div>
        <a routerLink="/tools/timestamp" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Confirmed Anchor Batches</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Batch Identifier</th>
                <th>Block Height</th>
                <th>Block Hash</th>
                <th>Leaf Count</th>
                <th>Merkle Root</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let b of batches">
                <td class="font-monospace text-info">{{ b.batch_id }}</td>
                <td class="fw-bold">{{ b.block_height }}</td>
                <td class="font-monospace text-muted">{{ b.block_hash | slice:0:16 }}...</td>
                <td>{{ b.leaf_count | number }}</td>
                <td class="font-monospace text-success">{{ b.merkle_root | slice:0:16 }}...</td>
                <td>{{ b.anchored_at | date:'medium' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class OpenTimestampsBatchesComponent implements OnInit {
  public batches: any[] = [];

  constructor(private api: OpenTimestampsApiService) {}

  public ngOnInit(): void {
    this.api.getBatches$().subscribe(res => {
      this.batches = res;
    });
  }
}
