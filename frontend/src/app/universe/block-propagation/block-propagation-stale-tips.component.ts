import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { BlockPropagationApiService, branchVerdict } from './block-propagation.service';
import { BlockPropagationOverview, BlockPropagationObservation, CompactBlockDetail, ForkRaceRecord, FibreObservation } from './block-propagation.models';
import { watchPropagation } from './propagation-load';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-block-propagation-stale-tips', standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
  <div class="container-xl py-4"><h1 class="h2 mb-3">Stale Tips & Reorganizations</h1><nav class="nav nav-pills flex-wrap gap-2 mb-4">
<a class="nav-link" [routerLink]="'/network/blocks' | relativeUrl">Overview</a>
<a class="nav-link" [routerLink]="'/network/blocks/live' | relativeUrl">Live Propagation</a>
<a class="nav-link" [routerLink]="'/network/compact-blocks' | relativeUrl">Compact Blocks</a>
<a class="nav-link" [routerLink]="'/network/fork-races' | relativeUrl">Fork Races</a>
<a class="nav-link" [routerLink]="'/network/stale-tips' | relativeUrl">Stale Tips</a>
<a class="nav-link" [routerLink]="'/network/fibre' | relativeUrl">FIBRE</a></nav>
  <p class="text-muted">Observations reported by the configured source; this page does not independently validate sensor coverage or chain consensus.</p>
  <div *ngIf="loading" role="status" aria-busy="true">Loading propagation evidence...</div>
  <div *ngIf="loadError" class="alert alert-warning" role="alert">{{ loadError }}</div>
  <p>Stale-tip history requires the owned propagation sensor fleet. No successful history contract is connected.</p><p>Stale and surviving hashes, miner attribution, lost subsidy/fees and reorganization depth remain unavailable.</p></div>
  `
})
export class BlockPropagationStaleTipsComponent implements OnInit, OnDestroy {
  staleTips: never | null = null;
  loading = false;
  loadError: string | null = null;
  readonly verdict = branchVerdict;
  private request?: Subscription;
  constructor(private api: BlockPropagationApiService) {}
  ngOnInit(): void {
    this.request = watchPropagation(this.api.networkChanged$ ?? of(''), () => this.api.getStaleTips$(), state => {
      this.staleTips = state.value; this.loading = state.loading; this.loadError = state.error;
    });
  }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
}
