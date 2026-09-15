import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { BlockPropagationApiService, branchVerdict } from './block-propagation.service';
import { BlockPropagationOverview, BlockPropagationObservation, CompactBlockDetail, ForkRaceRecord, FibreObservation } from './block-propagation.models';
import { watchPropagation } from './propagation-load';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-block-propagation-fibre', standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
  <div class="container-xl py-4"><h1 class="h2 mb-3">FIBRE Relay Observations</h1><nav class="nav nav-pills flex-wrap gap-2 mb-4">
<a [routerLink]="'/network/blocks' | relativeUrl">Overview</a>
<a [routerLink]="'/network/blocks/live' | relativeUrl">Live Propagation</a>
<a [routerLink]="'/network/compact-blocks' | relativeUrl">Compact Blocks</a>
<a [routerLink]="'/network/fork-races' | relativeUrl">Fork Races</a>
<a [routerLink]="'/network/stale-tips' | relativeUrl">Stale Tips</a>
<a [routerLink]="'/network/fibre' | relativeUrl">FIBRE</a></nav>
  <p class="text-muted">Observations reported by the configured source; this page does not independently validate sensor coverage or chain consensus.</p>
  <div *ngIf="loading" role="status" aria-busy="true">Loading propagation evidence...</div>
  <div *ngIf="loadError" class="alert alert-warning" role="alert">{{ loadError }}</div>
  <section *ngIf="fibre"><div class="table-responsive" tabindex="0"><table class="table table-hover"><thead><tr><th>Height</th><th>Block</th><th>FIBRE / BIP152 Delivery (ms)</th><th>Time Saved (ms)</th><th>Chunks</th><th>Chunk Loss</th><th>FEC Recovery</th></tr></thead><tbody><tr *ngFor="let f of fibre"><td>{{ f.height }}</td><td><code>{{ f.block_hash | slice:0:18 }}…</code></td><td>{{ f.fibre_delivery_time_ms }} / {{ f.bip152_delivery_time_ms }}</td><td>{{ f.time_saved_ms }}</td><td>{{ f.chunk_count }}</td><td>{{ f.chunk_loss_pct }}%</td><td>{{ f.fec_recovery_succeeded ? 'Source reports success' : 'Source reports failure' }}</td></tr></tbody></table></div><p *ngIf="!fibre.length">The source returned no FIBRE observations.</p></section><p>Relay node inventory, optical paths, ping health and bandwidth compression are not reported by this source contract.</p></div>
  `
})
export class BlockPropagationFibreComponent implements OnInit, OnDestroy {
  fibre: FibreObservation[] | null = null;
  loading = false;
  loadError: string | null = null;
  readonly verdict = branchVerdict;
  private request?: Subscription;
  constructor(private api: BlockPropagationApiService) {}
  ngOnInit(): void {
    this.request = watchPropagation(this.api.networkChanged$ ?? of(''), () => this.api.getFibre$(), state => {
      this.fibre = state.value; this.loading = state.loading; this.loadError = state.error;
    });
  }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
}
