import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { BlockPropagationApiService, branchVerdict } from './block-propagation.service';
import { BlockPropagationOverview, BlockPropagationObservation, CompactBlockDetail, ForkRaceRecord, FibreObservation } from './block-propagation.models';
import { watchPropagation } from './propagation-load';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-block-propagation-fork-races', standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
  <div class="container-xl py-4"><h1 class="h2 mb-3">Block Fork-Race Observatory</h1><nav class="nav nav-pills flex-wrap gap-2 mb-4">
<a [routerLink]="'/network/blocks' | relativeUrl">Overview</a>
<a [routerLink]="'/network/blocks/live' | relativeUrl">Live Propagation</a>
<a [routerLink]="'/network/compact-blocks' | relativeUrl">Compact Blocks</a>
<a [routerLink]="'/network/fork-races' | relativeUrl">Fork Races</a>
<a [routerLink]="'/network/stale-tips' | relativeUrl">Stale Tips</a>
<a [routerLink]="'/network/fibre' | relativeUrl">FIBRE</a></nav>
  <p class="text-muted">Observations reported by the configured source; this page does not independently validate sensor coverage or chain consensus.</p>
  <div *ngIf="loading" role="status" aria-busy="true">Loading propagation evidence...</div>
  <div *ngIf="loadError" class="alert alert-warning" role="alert">{{ loadError }}</div>
  <section *ngIf="forkRaces"><div class="table-responsive" tabindex="0"><table class="table table-hover"><thead><tr><th>Race</th><th>Divergence Height</th><th>Discovered</th><th>Resolution</th><th>Reported Branches</th></tr></thead><tbody><tr *ngFor="let r of forkRaces"><td><a [routerLink]="['/network/fork-races' | relativeUrl, r.race_id]">{{ r.race_id }}</a></td><td>{{ r.divergence_height }}</td><td>{{ r.discovered_at_utc | date:'short' }}</td><td>{{ r.resolution_status }}</td><td><div *ngFor="let b of r.branches">{{ b.branch_id }}: {{ verdict(r, b) }}<br><code>{{ b.tip_block_hash }}</code></div></td></tr></tbody></table></div><p *ngIf="!forkRaces.length">The source returned no race records.</p></section></div>
  `
})
export class BlockPropagationForkRacesComponent implements OnInit, OnDestroy {
  forkRaces: ForkRaceRecord[] | null = null;
  loading = false;
  loadError: string | null = null;
  readonly verdict = branchVerdict;
  private request?: Subscription;
  constructor(private api: BlockPropagationApiService) {}
  ngOnInit(): void {
    this.request = watchPropagation(this.api.networkChanged$ ?? of(''), () => this.api.getForkRaces$(), state => {
      this.forkRaces = state.value; this.loading = state.loading; this.loadError = state.error;
    });
  }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
}
