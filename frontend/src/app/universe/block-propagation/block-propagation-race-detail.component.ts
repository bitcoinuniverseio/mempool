import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { BlockPropagationApiService } from './block-propagation.service';

@Component({
  selector: 'app-block-propagation-race-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4" *ngIf="race">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Fork Race: <span class="text-info">{{ race.race_id }}</span> (Height {{ race.height }})</h1>
          <p class="text-muted mb-0">Observed at {{ race.observed_at }} with {{ race.time_difference_ms }} ms arrival spread.</p>
        </div>
        <a routerLink="/network/fork-races" class="btn btn-outline-secondary btn-sm">Back to Fork Races</a>
      </div>

      <div class="row g-4 mb-4">
        <div class="col-md-6">
          <div class="card bg-dark border-success p-3 h-100">
            <div class="d-flex justify-content-between">
              <span class="badge bg-success">MAIN CHAIN WINNER</span>
              <span class="text-muted small">{{ race.block_a.received_first_pct }}% initial arrival</span>
            </div>
            <h5 class="mt-3 text-light">Miner: {{ race.block_a.miner }}</h5>
            <div class="font-monospace small text-muted text-break my-2">{{ race.block_a.hash }}</div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card bg-dark border-danger p-3 h-100">
            <div class="d-flex justify-content-between">
              <span class="badge bg-danger">STALE REORG</span>
              <span class="text-muted small">{{ race.block_b.received_first_pct }}% initial arrival</span>
            </div>
            <h5 class="mt-3 text-light">Miner: {{ race.block_b.miner }}</h5>
            <div class="font-monospace small text-muted text-break my-2">{{ race.block_b.hash }}</div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Regional First-Hop Reception Split</h5>
        </div>
        <div class="card-body" *ngIf="race.node_split_map">
          <div class="row">
            <div class="col-md-4" *ngFor="let entry of race.node_split_map | keyvalue">
              <div class="p-3 bg-black rounded border border-secondary text-center mb-2">
                <div class="text-muted small text-uppercase">{{ entry.key }}</div>
                <div class="h5 fw-bold text-info my-1">{{ entry.value }}</div>
                <div class="small text-muted">First received</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class BlockPropagationRaceDetailComponent implements OnInit {
  public race: any = null;

  constructor(
    private route: ActivatedRoute,
    private api: BlockPropagationApiService
  ) {}

  public ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const raceId = params.get('raceId') || 'race-863920';
      this.api.getForkRace$(raceId).subscribe(res => {
        this.race = res;
      });
    });
  }
}
