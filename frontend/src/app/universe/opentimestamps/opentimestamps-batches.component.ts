import { Subscription } from 'rxjs';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { OpenTimestampsApiService, TimestampAnchor, TimestampCoverage } from './opentimestamps.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/**
 * Bitcoin blocks that anchored proofs stamped through this deployment, one
 * row per calendar and block. A proof commits to the block's Merkle root and
 * never names the calendar's transaction, so there is no txid to show.
 */
@Component({
  selector: 'app-opentimestamps-batches',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Anchors</h1>
          <p class="text-muted mb-0">Bitcoin blocks that anchored proofs stamped here.</p>
        </div>
        <a [routerLink]="'/tools/timestamp' | relativeUrl" class="btn btn-outline-secondary btn-sm">Overview</a>
      </div>

      <div class="alert alert-warning" role="alert" *ngIf="loadError">{{ loadError }}</div>
      <p class="text-muted" *ngIf="loading" role="status">Loading</p>

      <div class="card" *ngIf="!loading && !loadError">
        <p class="p-3 small" *ngIf="coverage">Owned-chain readback: {{ coverage.records_examined }} stored records examined (limit {{ coverage.record_limit }}). {{ coverage.complete ? 'Complete stored anchor window.' : 'Partial coverage; counts are lower bounds.' }} Proofs may become orphaned after this read.</p>
        <p class="text-muted p-3 mb-0" *ngIf="!anchors.length">No current anchor was verified in the observed record window.</p>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Anchors, scroll horizontally" i18n-aria-label *ngIf="anchors.length">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Calendar</th>
                <th>Block</th>
                <th>Block hash</th>
                <th>Proofs</th>
                <th>Bitcoin header Merkle root</th>
                <th>Anchored</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let a of anchors">
                <td>{{ a.calendar_id }}</td>
                <td class="fw-bold"><a [routerLink]="['/block' | relativeUrl, a.block_hash]">{{ a.block_height }}</a></td>
                <td class="font-monospace text-muted" [title]="a.block_hash">{{ a.block_hash | slice:0:16 }}&hellip;</td>
                <td>{{ a.leaf_count | number }}</td>
                <td class="font-monospace text-muted" [title]="a.merkle_root">{{ a.merkle_root | slice:0:16 }}&hellip;</td>
                <td class="small">{{ a.anchored_at | date:'medium' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class OpenTimestampsBatchesComponent implements OnInit, OnDestroy {
  private subscription?: Subscription;
  public ngOnDestroy(): void { this.subscription?.unsubscribe(); }
  public coverage: TimestampCoverage | null = null;
  public anchors: TimestampAnchor[] = [];
  public loadError: string | null = null;
  public loading = true;

  constructor(private api: OpenTimestampsApiService) {}

  public ngOnInit(): void {
    this.subscription = this.api.watch(() => this.api.getAnchorPage$()).subscribe(state => {
      this.loading = state.loading;
      this.loadError = state.error ? loadFailureMessage(classifyLoadFailure(state.error)) : null;
      this.anchors = state.value?.anchors ?? [];
      this.coverage = state.value?.coverage ?? null;
    });
  }
}
