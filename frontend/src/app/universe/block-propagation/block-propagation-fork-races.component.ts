import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BlockPropagationApiService } from './block-propagation.service';

@Component({
  selector: 'app-block-propagation-fork-races',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Block Fork-Race Observatory</h1>
          <p class="text-muted mb-0">Analysis of near-simultaneous block discoveries, geographic split propagation, and resolution outcomes.</p>
        </div>
        <a routerLink="/network/blocks" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Detected Simultaneous Block Races</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Race ID</th>
                <th>Height</th>
                <th>Observed At</th>
                <th>Block Candidate A</th>
                <th>Block Candidate B</th>
                <th>Delta</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let r of forkRaces">
                <td class="font-monospace text-muted">{{ r.race_id }}</td>
                <td class="fw-bold">{{ r.height }}</td>
                <td>{{ r.observed_at | date:'short' }}</td>
                <td>
                  <span class="badge bg-success me-1">{{ r.block_a.miner }}</span>
                  <span class="small text-muted">{{ r.block_a.received_first_pct }}% of probes</span>
                </td>
                <td>
                  <span class="badge bg-danger me-1">{{ r.block_b.miner }}</span>
                  <span class="small text-muted">{{ r.block_b.received_first_pct }}% of probes</span>
                </td>
                <td class="font-monospace text-warning">{{ r.time_difference_ms }} ms</td>
                <td>
                  <a [routerLink]="['/network/fork-races', r.race_id]" class="btn btn-outline-info btn-sm">Inspect Race</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class BlockPropagationForkRacesComponent implements OnInit {
  public forkRaces: any[] = [];

  constructor(private api: BlockPropagationApiService) {}

  public ngOnInit(): void {
    this.api.getForkRaces$().subscribe(res => {
      this.forkRaces = res;
    });
  }
}
