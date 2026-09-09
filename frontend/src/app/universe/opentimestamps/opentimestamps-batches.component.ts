import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { OpenTimestampsApiService, TimestampAnchor } from './opentimestamps.service';

/**
 * Bitcoin blocks that anchored proofs stamped through this deployment, one
 * row per calendar and block. A proof commits to the block's Merkle root and
 * never names the calendar's transaction, so there is no txid to show.
 */
@Component({
  selector: 'app-opentimestamps-batches',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Anchors</h1>
          <p class="text-muted mb-0">Bitcoin blocks that anchored proofs stamped here.</p>
        </div>
        <a routerLink="/tools/timestamp" class="btn btn-outline-secondary btn-sm">Overview</a>
      </div>

      <div class="alert alert-warning" role="alert" *ngIf="loadError">{{ loadError }}</div>
      <p class="text-muted" *ngIf="loading" role="status">Loading</p>

      <div class="card" *ngIf="!loading && !loadError">
        <p class="text-muted p-3 mb-0" *ngIf="!anchors.length">No proof stamped here has been anchored yet.</p>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Anchors, scroll horizontally" i18n-aria-label *ngIf="anchors.length">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Calendar</th>
                <th>Block</th>
                <th>Block hash</th>
                <th>Proofs</th>
                <th>Commitment</th>
                <th>Anchored</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let a of anchors">
                <td>{{ a.calendar_id }}</td>
                <td class="fw-bold"><a [routerLink]="['/block', a.block_hash]">{{ a.block_height }}</a></td>
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
export class OpenTimestampsBatchesComponent implements OnInit {
  public anchors: TimestampAnchor[] = [];
  public loadError: string | null = null;
  public loading = true;

  constructor(private api: OpenTimestampsApiService) {}

  public ngOnInit(): void {
    this.api.getBatches$().subscribe({
      next: res => {
        this.anchors = res ?? [];
        this.loadError = null;
        this.loading = false;
      },
      error: err => {
        this.anchors = [];
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
        this.loading = false;
      },
    });
  }
}
