import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { BlockPropagationApiService, branchVerdict } from './block-propagation.service';
import { BlockPropagationOverview, BlockPropagationObservation, CompactBlockDetail, ForkRaceRecord, FibreObservation } from './block-propagation.models';
import { watchPropagation } from './propagation-load';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-block-propagation-overview', standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
  <div class="container-xl py-4"><h1 class="h2 mb-3">Block Propagation & Compact-Block Observatory</h1><nav class="nav nav-pills flex-wrap gap-2 mb-4">
<a class="nav-link" [routerLink]="'/network/blocks' | relativeUrl">Overview</a>
<a class="nav-link" [routerLink]="'/network/blocks/live' | relativeUrl">Live Propagation</a>
<a class="nav-link" [routerLink]="'/network/compact-blocks' | relativeUrl">Compact Blocks</a>
<a class="nav-link" [routerLink]="'/network/fork-races' | relativeUrl">Fork Races</a>
<a class="nav-link" [routerLink]="'/network/stale-tips' | relativeUrl">Stale Tips</a>
<a class="nav-link" [routerLink]="'/network/fibre' | relativeUrl">FIBRE</a></nav>
  <p class="text-muted">Observations reported by the configured source; this page does not independently validate sensor coverage or chain consensus.</p>
  <div *ngIf="loading" role="status" aria-busy="true">Loading propagation evidence...</div>
  <div *ngIf="loadError" class="alert alert-warning" role="alert">{{ loadError }}</div>
  <section *ngIf="overview"><h2 class="h5">Source-reported Sensor Summary</h2><dl>
<dt>Active Sensors</dt><dd>{{ overview.active_sensors_count }}</dd>
<dt>Average Time to 50% of Sensors</dt><dd>{{ overview.average_propagation_time_50_pct_ms }} ms</dd>
<dt>Average Time to 90% of Sensors</dt><dd>{{ overview.average_propagation_time_90_pct_ms }} ms</dd>
<dt>Reconstruction Success Rate</dt><dd>{{ overview.reconstruction_success_rate_pct }}%</dd></dl>
<p>P99, miner attribution and network-wide coverage are not reported by this source contract.</p><div class="table-responsive" tabindex="0"><table class="table table-hover"><thead><tr><th>Height</th><th>Hash</th><th>Transactions</th><th>T50 Sensors (ms)</th><th>T90 Sensors (ms)</th><th>Full-block Fallbacks</th><th>Relay Observations</th></tr></thead><tbody><tr *ngFor="let b of overview.recent_blocks"><td>{{ b.height }}</td><td><a [routerLink]="['/network/blocks' | relativeUrl, b.block_hash]">{{ b.block_hash | slice:0:18 }}…</a></td><td>{{ b.tx_count }}</td><td>{{ b.time_to_50_pct_sensors_ms }}</td><td>{{ b.time_to_90_pct_sensors_ms }}</td><td>{{ b.fallback_to_full_block_count }}</td><td><span *ngFor="let s of b.sensor_observations">{{ s.sensor_id }}: {{ s.relay_mechanism }}<br></span></td></tr></tbody></table></div>
<p *ngIf="!overview.recent_blocks.length">The source returned no recent block observations.</p></section></div>
  `
})
export class BlockPropagationOverviewComponent implements OnInit, OnDestroy {
  overview: BlockPropagationOverview | null = null;
  loading = false;
  loadError: string | null = null;
  readonly verdict = branchVerdict;
  private request?: Subscription;
  constructor(private api: BlockPropagationApiService) {}
  ngOnInit(): void {
    this.request = watchPropagation(this.api.networkChanged$ ?? of(''), () => this.api.getOverview$(), state => {
      this.overview = state.value; this.loading = state.loading; this.loadError = state.error;
    });
  }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
}
