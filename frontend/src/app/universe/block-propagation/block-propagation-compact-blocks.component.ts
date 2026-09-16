import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { BlockPropagationApiService, branchVerdict } from './block-propagation.service';
import { BlockPropagationOverview, BlockPropagationObservation, CompactBlockDetail, ForkRaceRecord, FibreObservation } from './block-propagation.models';
import { watchPropagation } from './propagation-load';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-block-propagation-compact-blocks', standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
  <div class="container-xl py-4"><h1 class="h2 mb-3">BIP152 Compact Block Reconstruction</h1><nav class="nav nav-pills flex-wrap gap-2 mb-4">
<a class="nav-link" [routerLink]="'/network/blocks' | relativeUrl">Overview</a>
<a class="nav-link" [routerLink]="'/network/blocks/live' | relativeUrl">Live Propagation</a>
<a class="nav-link" [routerLink]="'/network/compact-blocks' | relativeUrl">Compact Blocks</a>
<a class="nav-link" [routerLink]="'/network/fork-races' | relativeUrl">Fork Races</a>
<a class="nav-link" [routerLink]="'/network/stale-tips' | relativeUrl">Stale Tips</a>
<a class="nav-link" [routerLink]="'/network/fibre' | relativeUrl">FIBRE</a></nav>
  <p class="text-muted">Observations reported by the configured source; this page does not independently validate sensor coverage or chain consensus.</p>
  <div *ngIf="loading" role="status" aria-busy="true">Loading propagation evidence...</div>
  <div *ngIf="loadError" class="alert alert-warning" role="alert">{{ loadError }}</div>
  <section *ngIf="compactBlocks"><div class="table-responsive" tabindex="0"><table class="table table-hover"><thead><tr><th>Height</th><th>Hash</th><th>BIP152 Version</th><th>Prefilled / Short IDs</th><th>Missing / Collisions</th><th>Reconstruction</th><th>Merkle / Witness Checks</th><th>Full-block Fallback</th></tr></thead><tbody><tr *ngFor="let cb of compactBlocks"><td>{{ cb.height }}</td><td><a [routerLink]="['/network/blocks' | relativeUrl, cb.block_hash]">{{ cb.block_hash | slice:0:18 }}…</a></td><td>{{ cb.bip152_version }}</td><td>{{ cb.prefilled_tx_count }} / {{ cb.short_id_count }}</td><td>{{ cb.missing_tx_count }} / {{ cb.collision_count }}</td><td>{{ cb.reconstruction_success ? 'Source reports success' : 'Source reports failure' }}</td><td>{{ cb.merkle_root_verified ? 'Reported verified' : 'Not verified' }} / {{ cb.witness_commitment_verified ? 'Reported verified' : 'Not verified' }}</td><td>{{ cb.full_block_fallback ? 'Reported' : 'Not reported' }}</td></tr></tbody></table></div><p>Per-record reconstruction time, matched short IDs and hit rate are not included in this source contract.</p><p *ngIf="!compactBlocks.length">The source returned no reconstruction records.</p></section></div>
  `
})
export class BlockPropagationCompactBlocksComponent implements OnInit, OnDestroy {
  compactBlocks: CompactBlockDetail[] | null = null;
  loading = false;
  loadError: string | null = null;
  readonly verdict = branchVerdict;
  private request?: Subscription;
  constructor(private api: BlockPropagationApiService) {}
  ngOnInit(): void {
    this.request = watchPropagation(this.api.networkChanged$ ?? of(''), () => this.api.getCompactBlocks$(), state => {
      this.compactBlocks = state.value; this.loading = state.loading; this.loadError = state.error;
    });
  }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
}
