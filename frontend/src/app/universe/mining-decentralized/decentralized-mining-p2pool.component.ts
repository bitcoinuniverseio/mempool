import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { DecentralizedMiningApiService, MiningShare } from './decentralized-mining.service';

@Component({
  selector: 'app-decentralized-mining-p2pool',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">P2Pool v2 Sharechain Observatory</h1>
          <span class="badge bg-success" *ngIf="shares.length > 0">
            {{ shares.length }} Shares Observed
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Peer-to-peer sharechain consensus, PPLNS decentralized coinbase distribution, and uncle rate telemetry.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/mining/decentralized">Overview</a>
          <a class="nav-link" routerLink="/mining/decentralized/datum">DATUM</a>
          <a class="nav-link active" routerLink="/mining/decentralized/p2pool">P2Pool v2</a>
          <a class="nav-link" routerLink="/mining/decentralized/braidpool">Braidpool</a>
          <a class="nav-link" routerLink="/mining/decentralized/compare">Template Autonomy</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading P2Pool sharechain...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && shares.length > 0" class="card p-4 bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Share ID</th>
                <th>Share Height</th>
                <th>Payout Script</th>
                <th>Target</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of shares">
                <td class="font-monospace fw-bold">{{ s.share_id }}</td>
                <td class="font-monospace">#{{ s.share_height }}</td>
                <td class="font-monospace small text-truncate" style="max-width: 250px;">{{ s.payout_script }}</td>
                <td class="font-monospace small">{{ s.difficulty_target }}</td>
                <td>
                  <a [routerLink]="['/mining/decentralized/share', s.share_id]" class="btn btn-sm btn-outline-primary">
                    Inspect
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
export class DecentralizedMiningP2poolComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  shares: MiningShare[] = [];
  private sub?: Subscription;

  constructor(
    private miningApi: DecentralizedMiningApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.miningApi.getShares$('p2pool').subscribe({
      next: (data) => {
        this.shares = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load P2Pool shares';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
