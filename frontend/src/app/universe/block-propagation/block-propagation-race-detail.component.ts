import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription, of, combineLatest } from 'rxjs';
import { BlockPropagationApiService, branchVerdict } from './block-propagation.service';
import { BlockPropagationOverview, BlockPropagationObservation, CompactBlockDetail, ForkRaceRecord, FibreObservation } from './block-propagation.models';
import { watchPropagation } from './propagation-load';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-block-propagation-race-detail', standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
  <div class="container-xl py-4"><h1 class="h2 mb-3">Fork Race Analysis</h1><nav class="nav nav-pills flex-wrap gap-2 mb-4">
<a [routerLink]="'/network/blocks' | relativeUrl">Overview</a>
<a [routerLink]="'/network/blocks/live' | relativeUrl">Live Propagation</a>
<a [routerLink]="'/network/compact-blocks' | relativeUrl">Compact Blocks</a>
<a [routerLink]="'/network/fork-races' | relativeUrl">Fork Races</a>
<a [routerLink]="'/network/stale-tips' | relativeUrl">Stale Tips</a>
<a [routerLink]="'/network/fibre' | relativeUrl">FIBRE</a></nav>
  <p class="text-muted">Observations reported by the configured source; this page does not independently validate sensor coverage or chain consensus.</p>
  <div *ngIf="loading" role="status" aria-busy="true">Loading propagation evidence...</div>
  <div *ngIf="loadError" class="alert alert-warning" role="alert">{{ loadError }}</div>
  <section *ngIf="race"><h2 class="h5">{{ race.race_id }} — Divergence Height {{ race.divergence_height }}</h2>
<p>Observed {{ race.discovered_at_utc | date:'medium' }}. Source resolution: <strong>{{ race.resolution_status }}</strong></p>
<div class="card p-3 mb-3" *ngFor="let b of race.branches"><h3 class="h6">{{ b.branch_id }} — {{ verdict(race, b) }}</h3><code class="text-break">{{ b.tip_block_hash }}</code>
<p>Height {{ b.tip_height }}; accumulated work {{ b.accumulated_work }}</p><p>First observed by {{ b.first_observed_sensor_id }} at {{ b.first_observed_utc | date:'medium' }}</p><p>Source-attributed pool: {{ b.mined_by_pool || 'Not reported' }}</p></div>
<p>Arrival percentages, geographic split and miner economic losses are not supplied by this source contract.</p><ul><li *ngFor="let note of race.notes">{{ note }}</li></ul></section></div>
  `
})
export class BlockPropagationRaceDetailComponent implements OnInit, OnDestroy {
  race: ForkRaceRecord | null = null;
  loading = false;
  loadError: string | null = null;
  readonly verdict = branchVerdict;
  private request?: Subscription;
  constructor(private route: ActivatedRoute, private api: BlockPropagationApiService) {}
  ngOnInit(): void {
    this.request = watchPropagation(combineLatest([this.api.networkChanged$ ?? of(''), this.route.paramMap]), ([, params]) => this.api.getForkRace$(params.get('raceId') || ''), state => {
      this.race = state.value; this.loading = state.loading; this.loadError = state.error;
    });
  }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
}
