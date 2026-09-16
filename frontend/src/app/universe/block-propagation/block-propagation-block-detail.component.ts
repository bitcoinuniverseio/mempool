import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription, of, combineLatest } from 'rxjs';
import { BlockPropagationApiService, branchVerdict } from './block-propagation.service';
import { BlockPropagationOverview, BlockPropagationObservation, CompactBlockDetail, ForkRaceRecord, FibreObservation } from './block-propagation.models';
import { watchPropagation } from './propagation-load';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-block-propagation-block-detail', standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
  <div class="container-xl py-4"><h1 class="h2 mb-3">Block Propagation Analysis</h1><nav class="nav nav-pills flex-wrap gap-2 mb-4">
<a class="nav-link" [routerLink]="'/network/blocks' | relativeUrl">Overview</a>
<a class="nav-link" [routerLink]="'/network/blocks/live' | relativeUrl">Live Propagation</a>
<a class="nav-link" [routerLink]="'/network/compact-blocks' | relativeUrl">Compact Blocks</a>
<a class="nav-link" [routerLink]="'/network/fork-races' | relativeUrl">Fork Races</a>
<a class="nav-link" [routerLink]="'/network/stale-tips' | relativeUrl">Stale Tips</a>
<a class="nav-link" [routerLink]="'/network/fibre' | relativeUrl">FIBRE</a></nav>
  <p class="text-muted">Observations reported by the configured source; this page does not independently validate sensor coverage or chain consensus.</p>
  <div *ngIf="loading" role="status" aria-busy="true">Loading propagation evidence...</div>
  <div *ngIf="loadError" class="alert alert-warning" role="alert">{{ loadError }}</div>
  <section *ngIf="block"><h2 class="h5">Block {{ block.height }}</h2><p class="font-monospace text-break">{{ block.block_hash }}</p>
<dl><dt>Transactions / Size</dt><dd>{{ block.tx_count }} / {{ block.block_size_bytes }} bytes</dd>
<dt>Time to 50% / 90% / 100% of Sensors</dt><dd>{{ block.time_to_50_pct_sensors_ms }} / {{ block.time_to_90_pct_sensors_ms }} / {{ block.time_to_100_pct_sensors_ms }} ms</dd>
<dt>Average Reconstruction Duration</dt><dd>{{ block.average_reconstruction_duration_ms }} ms</dd>
<dt>Full-block Fallbacks / Short-ID Collisions</dt><dd>{{ block.fallback_to_full_block_count }} / {{ block.short_id_collision_count }}</dd></dl>
<p>Stage timestamps are source observations in milliseconds, not independently verified arrival deltas.</p>
<div class="table-responsive" tabindex="0"><table class="table table-hover"><thead><tr><th>Sensor</th><th>Region</th><th>Relay Mechanism</th><th>Header First Seen (ms)</th><th>Validation Complete (ms)</th></tr></thead><tbody><tr *ngFor="let s of block.sensor_observations"><td>{{ s.sensor_id }}</td><td>{{ s.region }}</td><td>{{ s.relay_mechanism }}</td><td>{{ s.stages.header_first_seen_ms }}</td><td>{{ s.stages.validation_complete_ms }}</td></tr></tbody></table></div></section></div>
  `
})
export class BlockPropagationBlockDetailComponent implements OnInit, OnDestroy {
  block: BlockPropagationObservation | null = null;
  loading = false;
  loadError: string | null = null;
  readonly verdict = branchVerdict;
  private request?: Subscription;
  constructor(private route: ActivatedRoute, private api: BlockPropagationApiService) {}
  ngOnInit(): void {
    this.request = watchPropagation(combineLatest([this.api.networkChanged$ ?? of(''), this.route.paramMap]), ([, params]) => this.api.getBlock$(params.get('blockHash') || ''), state => {
      this.block = state.value; this.loading = state.loading; this.loadError = state.error;
    });
  }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
}
