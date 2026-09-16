import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { DecentralizedMiningApiService, MiningShare } from './decentralized-mining.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-decentralized-mining-braidpool',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Braidpool DAG Sharechain Observatory</h1>
          <span class="badge bg-info text-dark" *ngIf="shares.length > 0">
            {{ shares.length }} DAG Blocks
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Directed Acyclic Graph (DAG) sharechain with multi-parent concurrency, zero-uncle discard, and miner template autonomy.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/mining/decentralized' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/mining/decentralized/datum' | relativeUrl">DATUM</a>
          <a class="nav-link" [routerLink]="'/mining/decentralized/p2pool' | relativeUrl">P2Pool v2</a>
          <a class="nav-link active" [routerLink]="'/mining/decentralized/braidpool' | relativeUrl">Braidpool</a>
          <a class="nav-link" [routerLink]="'/mining/decentralized/compare' | relativeUrl">Template Autonomy</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Braidpool DAG shares...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && shares.length > 0" class="card p-4 bg-body-tertiary border">
        <div class="table-responsive" tabindex="0">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Share ID</th>
                <th>Height</th>
                <th>Multi-Parent Count</th>
                <th>Miner Identity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of shares">
                <td class="font-monospace fw-bold">{{ s.share_id }}</td>
                <td class="font-monospace">#{{ s.share_height }}</td>
                <td>
                  <span class="badge bg-secondary font-monospace">
                    {{ s.parent_share_hashes.length }} parents
                  </span>
                </td>
                <td class="font-monospace small text-truncate" style="max-width: 200px;">{{ s.miner_identity }}</td>
                <td>
                  <a [routerLink]="['/mining/decentralized/share' | relativeUrl, s.share_id]" class="btn btn-sm btn-outline-primary">
                    Inspect DAG Block
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class DecentralizedMiningBraidpoolComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  shares: MiningShare[] = [];
  private sub?: Subscription;

  constructor(
    private miningApi: DecentralizedMiningApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.miningApi.getShares$('braidpool').subscribe({
      next: (data) => {
        this.shares = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = loadFailureMessage(classifyLoadFailure(err));
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
