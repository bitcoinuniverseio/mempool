import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { LightningReliabilityApiService, LightningClosureForensics } from './lightning-reliability.service';

@Component({
  selector: 'app-lightning-closure-forensics',
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
          <span class="text-muted small">Lightning Forensics</span>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Lightning Closure Forensics</h1>
          <span class="badge" [ngClass]="{
            'bg-success': forensics?.closure_type === 'cooperative',
            'bg-warning': forensics?.closure_type === 'unilateral',
            'bg-danger': forensics?.closure_type === 'penalty_breach'
          }" *ngIf="forensics">
            {{ forensics.closure_type | titlecase }} Closure
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading channel closure forensics...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && forensics" class="content-body">
        <!-- Closure Summary -->
        <div class="card p-4 mb-4 bg-body-tertiary border">
          <div class="row g-3">
            <div class="col-12 col-md-8">
              <div class="text-muted small">Closure Spending Transaction (txid)</div>
              <div class="h5 text-primary font-monospace text-break">{{ forensics.closure_txid }}</div>
            </div>
            <div class="col-12 col-md-4">
              <div class="text-muted small">Channel Identifier</div>
              <div class="h5 font-monospace">{{ forensics.channel_id }}</div>
            </div>
          </div>
        </div>

        <!-- Forensics Cards -->
        <div class="row g-3 mb-4">
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Reclaimed Balance</div>
              <div class="h4 my-1 text-success">{{ forensics.reclaimed_balance_sats | number }} sats</div>
              <div class="small text-muted">Directly settled outpoint</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Contested Balance</div>
              <div class="h4 my-1 text-warning">{{ forensics.contested_balance_sats | number }} sats</div>
              <div class="small text-muted">Under CSV/CLTV dispute</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Swept HTLCs Count</div>
              <div class="h4 my-1 text-secondary">{{ forensics.swept_htlcs_count }}</div>
              <div class="small text-muted">In-flight payment sweeps</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Settlement Status</div>
              <div class="h4 my-1 text-info">{{ forensics.settlement_status | titlecase }}</div>
              <div class="small text-muted">{{ forensics.timelock_delay_blocks }} blocks delay</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LightningClosureForensicsComponent implements OnInit, OnDestroy {
  forensics: LightningClosureForensics | null = null;
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
        const txid = params.get('txid');
        if (txid) {
          this.fetchForensics(txid);
        }
      })
    );
  }

  private fetchForensics(txid: string): void {
    this.loading = true;
    this.sub.add(
      this.api.getClosureForensics$(txid).subscribe({
        next: data => {
          this.forensics = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.error?.error || err?.message || 'Failed to load closure forensics';
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
