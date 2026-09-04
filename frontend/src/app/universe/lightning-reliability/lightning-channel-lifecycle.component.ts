import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { LightningReliabilityApiService, LightningChannelLifecycle } from './lightning-reliability.service';

@Component({
  selector: 'app-lightning-channel-lifecycle',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="d-flex align-items-center gap-2 mb-2">
          <a routerLink="/lightning/reliability" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Reliability Overview
          </a>
          <span class="text-muted small">Lightning Channel Intelligence</span>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Lightning Channel Lifecycle</h1>
          <span class="badge" [ngClass]="channel && channel.status === 'active' ? 'bg-success' : 'bg-secondary'" *ngIf="channel">
            {{ channel.status | titlecase }} Channel
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading channel lifecycle history...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && channel" class="content-body">
        <!-- Channel Top Summary -->
        <div class="card p-4 mb-4 bg-body-tertiary border">
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <div class="text-muted small">Short Channel Identifier</div>
              <div class="h4 text-primary font-monospace">{{ channel.short_channel_id }}</div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-muted small">Channel Capacity</div>
              <div class="h4 font-monospace">{{ (channel.capacity_sats / 100000000).toFixed(4) }} BTC ({{ channel.capacity_sats | number }} sats)</div>
            </div>
          </div>
        </div>

        <!-- Channel Participants & On-chain Events -->
        <div class="row g-4 mb-4">
          <div class="col-12 col-md-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h2 class="h5 mb-3">Channel Participants</h2>
              <div class="mb-3">
                <div class="text-muted small">Node 1: {{ channel.node1_alias || 'Unnamed' }}</div>
                <code class="small text-break">{{ channel.node1_pubkey }}</code>
              </div>
              <div>
                <div class="text-muted small">Node 2: {{ channel.node2_alias || 'Unnamed' }}</div>
                <code class="small text-break">{{ channel.node2_pubkey }}</code>
              </div>
            </div>
          </div>

          <div class="col-12 col-md-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h2 class="h5 mb-3">On-Chain Lifecycle Anchors</h2>
              <ul class="list-group list-group-flush bg-transparent">
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Funding Block Height</span>
                  <span class="fw-semibold">{{ channel.opened_height | number }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Funding Outpoint</span>
                  <code class="small text-break">{{ channel.funding_txid }}:{{ channel.funding_vout }}</code>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0" *ngIf="channel.closed_height">
                  <span class="text-muted">Closure Block Height</span>
                  <span class="fw-semibold">{{ channel.closed_height | number }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0" *ngIf="channel.closure_type">
                  <span class="text-muted">Closure Classification</span>
                  <span class="badge bg-secondary">{{ channel.closure_type | titlecase }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- If closed, link to closure forensics -->
        <div *ngIf="channel.closure_txid" class="card p-3 bg-body-tertiary border d-flex flex-row justify-content-between align-items-center">
          <div>
            <div class="fw-semibold">Channel Closure Forensics Available</div>
            <div class="small text-muted">Inspect settlement mechanics, contested balances, and timelocks.</div>
          </div>
          <a [routerLink]="['/lightning/closure', channel.closure_txid]" class="btn btn-primary">
            Inspect Closure Forensics
          </a>
        </div>
      </div>
    </div>
  `,
})
export class LightningChannelLifecycleComponent implements OnInit, OnDestroy {
  channel: LightningChannelLifecycle | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private api: LightningReliabilityApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.route.paramMap.subscribe(params => {
        const shortId = params.get('shortId');
        if (shortId) {
          this.fetchChannel(shortId);
        }
      })
    );
  }

  private fetchChannel(shortId: string): void {
    this.loading = true;
    this.sub.add(
      this.api.getChannelLifecycle$(shortId).subscribe({
        next: data => {
          this.channel = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.error?.error || err?.message || 'Failed to load channel lifecycle';
          this.loading = false;
          this.cd.markForCheck();
        },
      })
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
