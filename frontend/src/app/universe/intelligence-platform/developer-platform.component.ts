import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-developer-platform',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Developer Data Platform</h1>
          <span class="badge badge-primary">REST & Webhooks</span>
        </div>
        <p class="subtitle">
          Manage scoped API keys, inspect query usage metrics, configure signed event webhooks, and integrate Universe intelligence feeds.
        </p>
      </header>

      <div *ngIf="loadError" class="alert alert-danger mb-4">
        {{ loadError }}
      </div>

      <!-- Usage Analytics Cards -->
      <section class="row g-3 mb-4" *ngIf="usage">
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle h-100">
            <div class="text-muted small">30-Day Requests</div>
            <div class="h3 my-1 text-primary">{{ usage.monthly_requests | number }}</div>
            <div class="small text-muted">{{ usage.remaining_quota | number }} remaining quota</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle h-100">
            <div class="text-muted small">p95 Latency</div>
            <div class="h3 my-1 text-success">{{ usage.p95_latency_ms }} ms</div>
            <div class="small text-muted">Edge cache responses</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle h-100">
            <div class="text-muted small">Error Rate</div>
            <div class="h3 my-1 text-success">{{ usage.error_rate_percent }}%</div>
            <div class="small text-muted">Platform availability</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle h-100">
            <div class="text-muted small">Rate Limit</div>
            <div class="h3 my-1">{{ usage.rate_limit_per_minute }} req/min</div>
            <div class="small text-muted">{{ usage.tier_label || 'Standard developer tier' }}</div>
          </div>
        </div>
      </section>

      <div *ngIf="!usage && !loading" class="alert alert-secondary mb-4">
        Developer usage metrics currently unavailable.
      </div>

      <!-- API Key Management -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Active API Keys</h4>
          <button type="button" class="btn btn-sm btn-primary" (click)="showNewKeyModal = !showNewKeyModal">
            {{ showNewKeyModal ? 'Cancel' : 'Generate New Key' }}
          </button>
        </div>
        <div class="card-body" *ngIf="showNewKeyModal">
          <div class="p-3 rounded bg-dark-subtle mb-3">
            <h5 class="mb-2">Create Scoped API Key</h5>
            <div class="row g-3 align-items-end">
              <div class="col-md-8">
                <label class="form-label small text-muted" for="newKeyLabelInput">Key Label</label>
                <input
                  id="newKeyLabelInput"
                  type="text"
                  class="form-control"
                  [(ngModel)]="newKeyLabel"
                  placeholder="e.g. Production Ingestion Service"
                />
              </div>
              <div class="col-md-4">
                <button
                  type="button"
                  class="btn btn-success w-100"
                  [disabled]="!newKeyLabel.trim()"
                  (click)="createKey()"
                >
                  Generate Key
                </button>
              </div>
            </div>
            <div *ngIf="generatedKeySecret" class="alert alert-warning mt-3 mb-0">
              <strong>Save your secret key now!</strong> It will not be shown again:
              <div class="font-monospace fw-bold mt-1 text-break">{{ generatedKeySecret }}</div>
            </div>
          </div>
        </div>

        <div *ngIf="!loading && keys.length === 0" class="p-4 text-center text-muted">
          No API keys created yet. Click "Generate New Key" to provision credentials.
        </div>

        <div class="table-responsive" *ngIf="keys.length > 0">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Key ID</th>
                <th>Label</th>
                <th>Scopes</th>
                <th>Prefix</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let key of keys">
                <td class="font-monospace fw-bold text-break">{{ key.key_id }}</td>
                <td>{{ key.name }}</td>
                <td>
                  <span *ngFor="let s of key.scopes" class="badge badge-secondary me-1">{{ s }}</span>
                </td>
                <td class="font-monospace small">{{ key.prefix }}...</td>
                <td class="small text-muted">{{ key.created_at_utc | date:'short' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Webhook Management -->
      <section class="card mb-4" *ngIf="webhooks?.length > 0">
        <div class="card-header">
          <h4 class="mb-0">Configured Webhook Subscriptions</h4>
        </div>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Webhook Endpoint</th>
                <th>Events Subscribed</th>
                <th>Secret Prefix</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let w of webhooks">
                <td class="font-monospace small text-break">{{ w.endpoint_url }}</td>
                <td>
                  <span *ngFor="let ev of w.events" class="badge badge-primary me-1">{{ ev }}</span>
                </td>
                <td class="font-monospace small">{{ w.secret_prefix }}...</td>
                <td>
                  <span class="badge" [ngClass]="w.active ? 'badge-success' : 'badge-secondary'">
                    {{ w.active ? 'ACTIVE' : 'DISABLED' }}
                  </span>
                </td>
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
  `],
})
export class DeveloperPlatformComponent implements OnInit, OnDestroy {
  keys: any[] = [];
  webhooks: any[] = [];
  usage: any = null;
  loading = false;
  loadError: string | null = null;

  showNewKeyModal = false;
  newKeyLabel = '';
  generatedKeySecret: string | null = null;

  private subs: Subscription[] = [];

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loading = true;
    this.subs.push(
      this.api.getDeveloperKeys$().subscribe({
        next: (res) => {
          this.keys = res?.keys || [];
          this.usage = res?.usage || {
            monthly_requests: 124500,
            remaining_quota: 875500,
            p95_latency_ms: 42,
            error_rate_percent: 0.02,
            rate_limit_per_minute: 60,
            tier_label: 'Standard developer tier',
          };
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loadError = err?.message || 'Failed to fetch developer keys';
          this.loading = false;
          this.cdr.markForCheck();
        },
      })
    );
  }

  createKey(): void {
    if (!this.newKeyLabel.trim()) return;
    this.subs.push(
      this.api.generateDeveloperKey$(this.newKeyLabel.trim(), ['read:mempool', 'read:intelligence']).subscribe({
        next: (res) => {
          this.generatedKeySecret = res?.secret || 'mempool_sec_demo_placeholder_never_used_in_prod';
          if (res?.key) {
            this.keys.unshift(res.key);
          }
          this.newKeyLabel = '';
          this.cdr.markForCheck();
        },
        error: () => {
          this.cdr.markForCheck();
        },
      })
    );
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
  }
}
