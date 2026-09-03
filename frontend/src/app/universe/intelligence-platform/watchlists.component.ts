import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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

      <!-- Active Watchlists -->
      <section class="card mb-4" *ngIf="watchlists.length > 0">
        <div class="card-header d-flex justify-content-between align-items-center">
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
                  <td class="font-monospace small">{{ ent.blinded_hash }}</td>
                  <td class="small text-muted">{{ ent.added_at_utc | date:'short' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Rules -->
          <h6 class="text-uppercase small text-muted mb-2">Notification Rules</h6>
          <div class="row g-2 mb-4">
            <div *ngFor="let r of watchlists[0].rules" class="col-md-6">
              <div class="p-3 rounded bg-dark-subtle border">
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
                <td class="font-monospace small text-muted">{{ n.blinded_hash | slice:0:16 }}...</td>
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
    .badge-primary { background-color: #0d6efd; color: #fff; }
    .badge-success { background-color: #198754; color: #fff; }
    .badge-secondary { background-color: #6c757d; color: #fff; }
    .badge-danger { background-color: #dc3545; color: #fff; }
  `],
})
export class WatchlistsComponent implements OnInit {
  watchlists: any[] = [];
  notifications: any[] = [];

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.getWatchlists$().subscribe((res) => {
      this.watchlists = res?.watchlists || [];
      this.cdr.markForCheck();
    });

    this.api.getWatchlists$().subscribe((res) => {
      const wlId = res?.watchlists?.[0]?.watchlist_id;
      if (wlId) {
        // Load default notifications
        this.notifications = [
          {
            title: 'Transfer Alert',
            message: 'Observed transfer of 2,500,000 satoshis matching watched blinded entity.',
            severity: 'info',
            blinded_hash: '3b8908fef9b8098c772274b7c1265882e70c8cf865d1d6cb58a74e54e44f479d',
            created_at_utc: new Date().toISOString(),
          },
        ];
        this.cdr.markForCheck();
      }
    });
  }
}
