import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { DecentralizedMiningApiService, MiningShare } from './decentralized-mining.service';

@Component({
  selector: 'app-decentralized-mining-share-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a routerLink="/mining/decentralized" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Decentralized Mining
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="share">
          <div>
            <h1 class="m-0 font-monospace">{{ share.share_id }}</h1>
            <div class="text-muted small mt-1">Protocol: {{ share.protocol | uppercase }}</div>
          </div>
          <span class="badge" [ngClass]="share.is_valid ? 'bg-success' : 'bg-danger'">
            {{ share.is_valid ? 'VALID SHARE' : 'INVALID' }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading share details...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && share" class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border mb-4">
            <h2 class="h5 mb-3">Share Parameters & Template Binding</h2>
            <dl class="row mb-0">
              <dt class="col-sm-4 text-muted">Share Height</dt>
              <dd class="col-sm-8 font-monospace">#{{ share.share_height }}</dd>

              <dt class="col-sm-4 text-muted">Miner Identity</dt>
              <dd class="col-sm-8 font-monospace small text-break">{{ share.miner_identity }}</dd>

              <dt class="col-sm-4 text-muted">Payout Script</dt>
              <dd class="col-sm-8 font-monospace small text-break">{{ share.payout_script }}</dd>

              <dt class="col-sm-4 text-muted">Difficulty Target</dt>
              <dd class="col-sm-8 font-monospace small">{{ share.difficulty_target }}</dd>

              <dt class="col-sm-4 text-muted">Template Hash</dt>
              <dd class="col-sm-8 font-monospace small text-break">{{ share.template_hash }}</dd>

              <dt class="col-sm-4 text-muted">Observed Timestamp</dt>
              <dd class="col-sm-8 small">{{ share.observed_at }}</dd>
            </dl>
          </div>

          <div class="card p-4 bg-body-tertiary border" *ngIf="share.parent_share_hashes.length > 0">
            <h2 class="h5 mb-3">DAG Parent Share References</h2>
            <div *ngFor="let parent of share.parent_share_hashes" class="p-2 border rounded bg-body font-monospace small text-break mb-1">
              {{ parent }}
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">On-Chain Coinbase Linkage</h2>
            <div *ngIf="share.on_chain_txid" class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Mined Bitcoin Block Transaction</div>
              <div class="font-monospace small text-break mt-1">{{ share.on_chain_txid }}</div>
              <div class="mt-2">
                <span class="badge bg-success">COINBASE PAYOUT CONFIRMED</span>
              </div>
            </div>

            <div *ngIf="!share.on_chain_txid" class="text-center py-4 text-muted">
              <div class="badge bg-secondary mb-2">Internal Sharechain Share</div>
              <p class="small m-0">Share contributed to pool difficulty without meeting full Bitcoin target.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class DecentralizedMiningShareDetailComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  share: MiningShare | null = null;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private miningApi: DecentralizedMiningApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const shareId = this.route.snapshot.paramMap.get('shareId') || 'share-datum-881290';
    this.sub = this.miningApi.getShareById$(shareId).subscribe({
      next: (data) => {
        this.share = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load share details';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
