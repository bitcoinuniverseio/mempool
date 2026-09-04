import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-watchlists',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Privacy-First Watchlists, Rules, and Alerts</h1>
          <span class="badge badge-success">Blinded Hashing Enabled</span>
        </div>
        <p class="subtitle">
          Monitor addresses, transactions, and outpoints with zero plain-text IP logging or server-side address leakage using blinded entity matching.
        </p>
      </header>

      <div *ngIf="loadError" class="alert alert-danger mb-4">
        {{ loadError }}
      </div>

      <!-- Empty State -->
      <div *ngIf="!loading && watchlists.length === 0 && !loadError" class="card mb-4 text-center p-4 bg-dark-subtle">
        <div class="card-body">
          <h5>No Active Watchlists</h5>
          <p class="text-muted small mb-3">
            You have not configured any privacy-preserving watchlists yet. Create a local watchlist to monitor transaction lifecycle events.
          </p>
          <button type="button" class="btn btn-primary" (click)="createSampleWatchlist()">
            Create Sample Watchlist
          </button>
        </div>
      </div>

      <!-- Active Watchlists -->
      <section class="card mb-4" *ngIf="watchlists.length > 0">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Your Monitored Watchlists</h4>
          <span class="badge badge-primary">{{ watchlists[0].privacy_mode | uppercase }} PRIVACY</span>
        </div>
        <div class="card-body">
          <h5 class="mb-3">{{ watchlists[0].name }}</h5>

          <!-- Watched Entities -->
          <h6 class="text-uppercase small text-muted mb-2">Blinded Monitored Entities</h6>
          <div class="table-responsive mb-4">
            <table class="table table-sm table-hover mb-0">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Type</th>
                  <th>Blinded SHA-256 Hash</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let ent of watchlists[0].entities">
                  <td class="fw-bold">{{ ent.label }}</td>
                  <td><span class="badge badge-secondary">{{ ent.entity_type }}</span></td>
                  <td class="font-monospace small text-break">{{ ent.blinded_hash }}</td>
                  <td class="small text-muted">{{ ent.added_at_utc | date:'short' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Rules -->
          <h6 class="text-uppercase small text-muted mb-2">Notification Rules</h6>
          <div class="row g-2 mb-4">
            <div *ngFor="let r of watchlists[0].rules" class="col-md-6">
              <div class="p-3 rounded bg-dark-subtle border h-100">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <strong>Condition: {{ r.condition_type }}</strong>
                  <span class="badge badge-success">Active</span>
                </div>
                <div class="small text-muted" *ngIf="r.threshold_value">
                  Threshold: {{ r.threshold_value | number }} satoshis
                </div>
                <div class="small text-muted">Delivery Channel: {{ r.delivery_channel | uppercase }}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Notifications Feed -->
      <section class="card mb-4" *ngIf="notifications.length > 0">
        <div class="card-header">
          <h4 class="mb-0">Recent In-App Alert Notifications</h4>
        </div>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Alert Title</th>
                <th>Message</th>
                <th>Blinded Hash</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let n of notifications">
                <td>
                  <span class="badge" [ngClass]="n.severity === 'critical' ? 'badge-danger' : 'badge-primary'">
                    {{ n.severity | uppercase }}
                  </span>
                </td>
                <td class="fw-bold">{{ n.title }}</td>
                <td>{{ n.message }}</td>
                <td class="font-monospace small text-muted text-break">{{ n.blinded_hash | slice:0:16 }}...</td>
                <td class="small text-muted">{{ n.created_at_utc | date:'short' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .intelligence-page { padding-top: 2rem; padding-bottom: 4rem; }
    .page-header { margin-bottom: 2rem; }
    .title-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .badge {
      display: inline-block; padding: 0.35em 0.65em; font-size: 0.75em;
      font-weight: 700; line-height: 1; text-align: center; white-space: nowrap;
      vertical-align: baseline; border-radius: 0.25rem;
    }
    .badge-primary { background-color: var(--primary, #0d6efd); color: #fff; }
    .badge-secondary { background-color: var(--secondary, #6c757d); color: #fff; }
    .badge-success { background-color: var(--success, #198754); color: #fff; }
    .badge-danger { background-color: var(--danger, #dc3545); color: #fff; }
  `],
})
export class WatchlistsComponent implements OnInit, OnDestroy {
  watchlists: any[] = [];
  notifications: any[] = [];
  loading = false;
  loadError: string | null = null;

  private subs: Subscription[] = [];

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loading = true;
    this.subs.push(
      this.api.getWatchlists$().subscribe({
        next: (res) => {
          this.watchlists = res?.watchlists || [];
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loadError = err?.message || 'Failed to fetch watchlists';
          this.loading = false;
          this.cdr.markForCheck();
        },
      })
    );
  }

  createSampleWatchlist(): void {
    this.watchlists = [
      {
        id: 'wl-sample-01',
        name: 'Cold Storage Vault Monitoring',
        privacy_mode: 'blinded',
        entities: [
          {
            label: 'Multisig Vault Output',
            entity_type: 'outpoint',
            blinded_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
            added_at_utc: new Date().toISOString(),
          },
        ],
        rules: [
          {
            condition_type: 'spend_attempt',
            threshold_value: null,
            delivery_channel: 'in_app',
          },
        ],
      },
    ];
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
  }
}
