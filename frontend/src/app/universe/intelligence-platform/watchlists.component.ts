import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';
import { OwnerKeyService } from './owner-key.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

export const ENTITY_TYPES = ['address', 'txid', 'outpoint', 'descriptor'] as const;
export const CONDITION_TYPES = ['confirmation', 'value_transfer', 'rbf_replacement', 'feerate_cross', 'reorg_displaced'] as const;

/**
 * Watchlists for the owner whose key this browser holds. Everything shown
 * comes from the backend: the earlier revision offered a "sample watchlist"
 * that existed only in this component's state.
 */
@Component({
  selector: 'app-watchlists',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, RelativeUrlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Watchlists</h1>
          <span class="badge badge-success">Blinded</span>
        </div>
        <p class="subtitle">
          Addresses and transactions are stored as SHA-256 hashes and matched against confirmed blocks and mempool replacements.
        </p>
      </header>

      <div *ngIf="loadError" class="alert alert-danger mb-4">{{ loadError }}</div>

      <div *ngIf="!hasKey" class="alert alert-warning mb-4">
        Watchlists need an owner key. Create or paste one in the
        <a class="text-decoration-underline" [routerLink]="'/developers' | relativeUrl">Developer Platform</a> first.
      </div>

      <ng-container *ngIf="hasKey">
        <!-- Create -->
        <section class="card mb-4">
          <div class="card-body">
            <div class="row g-2 align-items-end">
              <div class="col-md-6">
                <label class="form-label small text-muted" for="newWatchlistName">New watchlist</label>
                <input id="newWatchlistName" type="text" class="form-control" [(ngModel)]="newName" placeholder="e.g. Cold storage" />
              </div>
              <div class="col-md-3">
                <button type="button" class="btn btn-primary w-100" [disabled]="!newName.trim() || busy" (click)="create()">Create</button>
              </div>
            </div>
          </div>
        </section>

        <div *ngIf="!loading && watchlists.length === 0 && !loadError" class="card mb-4 text-center p-4 bg-dark-subtle">
          <div class="card-body"><h5>No watchlists</h5><p class="text-muted small mb-0">Create one above, then add entities and rules.</p></div>
        </div>

        <section class="card mb-4" *ngFor="let wl of watchlists">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <h4 class="mb-0">{{ wl.name }} <span class="badge badge-primary ms-2">{{ wl.privacy_mode | uppercase }}</span><span class="badge badge-secondary ms-1">{{ wl.storage }}</span></h4>
            <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy" (click)="remove(wl.watchlist_id)">Delete</button>
          </div>
          <div class="card-body">
            <h6 class="text-uppercase small text-muted mb-2">Watched entities</h6>
            <div class="row g-2 align-items-end mb-2">
              <div class="col-md-2">
                <select class="form-control form-control-sm" [(ngModel)]="entityType[wl.watchlist_id]">
                  <option *ngFor="let t of entityTypes" [value]="t">{{ t }}</option>
                </select>
              </div>
              <div class="col-md-5"><input type="text" class="form-control form-control-sm font-monospace" [(ngModel)]="entityRaw[wl.watchlist_id]" placeholder="address or txid" aria-label="Address or txid, hashed before it is stored" /></div>
              <div class="col-md-3"><input type="text" class="form-control form-control-sm" [(ngModel)]="entityLabel[wl.watchlist_id]" placeholder="label" aria-label="Label" /></div>
              <div class="col-md-2"><button type="button" class="btn btn-sm btn-outline-primary w-100" [disabled]="!entityRaw[wl.watchlist_id] || busy" (click)="addEntity(wl.watchlist_id)">Add</button></div>
            </div>
            <div class="table-responsive mb-4" *ngIf="wl.entities.length" tabindex="0" role="region" aria-label="Watched entities, scroll horizontally" i18n-aria-label>
              <table class="table table-sm table-hover mb-0">
                <thead><tr><th>Label</th><th>Type</th><th>SHA-256</th><th>Added</th><th></th></tr></thead>
                <tbody>
                  <tr *ngFor="let ent of wl.entities">
                    <td class="fw-bold text-nowrap">{{ ent.label }}</td>
                    <td><span class="badge badge-secondary">{{ ent.entity_type }}</span></td>
                    <td class="font-monospace small text-nowrap">{{ ent.blinded_hash }}</td>
                    <td class="small text-muted text-nowrap">{{ ent.added_at_utc | date:'short' }}</td>
                    <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy" (click)="removeEntity(wl.watchlist_id, ent.entity_id)" aria-label="Remove entity">Remove</button></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h6 class="text-uppercase small text-muted mb-2">Rules</h6>
            <div class="row g-2 align-items-end mb-2">
              <div class="col-md-3">
                <select class="form-control form-control-sm" [(ngModel)]="ruleCondition[wl.watchlist_id]">
                  <option *ngFor="let c of conditionTypes" [value]="c">{{ c }}</option>
                </select>
              </div>
              <div class="col-md-3"><input type="number" class="form-control form-control-sm" [(ngModel)]="ruleThreshold[wl.watchlist_id]" [placeholder]="thresholdHint(ruleCondition[wl.watchlist_id])" aria-label="Threshold" /></div>
              <div class="col-md-2">
                <select class="form-control form-control-sm" [(ngModel)]="ruleChannel[wl.watchlist_id]" aria-label="Delivery"><option value="in_app">In app</option><option value="webhook" [disabled]="webhooks.length === 0">Webhook</option></select>
              </div>
              <div class="col-md-2">
                <select class="form-control form-control-sm" [(ngModel)]="ruleWebhook[wl.watchlist_id]" [disabled]="ruleChannel[wl.watchlist_id] !== 'webhook'" aria-label="Webhook">
                  <option *ngFor="let w of webhooks" [value]="w.webhook_id">{{ w.url }}</option>
                </select>
              </div>
              <div class="col-md-2"><button type="button" class="btn btn-sm btn-outline-primary w-100" [disabled]="busy || (ruleChannel[wl.watchlist_id] === 'webhook' && !ruleWebhook[wl.watchlist_id])" (click)="addRule(wl.watchlist_id)">Add rule</button></div>
            </div>
            <div class="row g-2">
              <div *ngFor="let r of wl.rules" class="col-md-6">
                <div class="p-3 rounded bg-dark-subtle border h-100">
                  <div class="d-flex justify-content-between align-items-center mb-1 gap-2">
                    <strong>{{ r.condition_type }}</strong>
                    <span class="d-flex align-items-center gap-2">
                      <span class="badge" [ngClass]="r.enabled ? 'badge-success' : 'badge-secondary'">{{ r.enabled ? 'Active' : 'Disabled' }}</span>
                      <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy" (click)="removeRule(wl.watchlist_id, r.rule_id)" aria-label="Remove rule">Remove</button>
                    </span>
                  </div>
                  <div class="small text-muted" *ngIf="r.threshold_value !== undefined && r.threshold_value !== null">Threshold {{ r.threshold_value | number }} {{ r.condition_type === 'feerate_cross' ? 'sat/vB' : 'sats' }}</div>
                  <div class="small text-muted">{{ r.delivery_channel === 'webhook' ? 'Webhook ' + webhookLabel(r.webhook_id) : 'In app' }}, max {{ r.rate_limit_per_hour }}/h</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h4 class="mb-0">Notifications</h4>
            <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadNotifications()">Refresh</button>
          </div>
          <div *ngIf="notifications.length === 0" class="p-4 text-center text-muted">No notifications yet.</div>
          <div class="table-responsive" *ngIf="notifications.length > 0" tabindex="0" role="region" aria-label="Notifications, scroll horizontally" i18n-aria-label>
            <table class="table table-hover mb-0">
              <thead><tr><th>Severity</th><th>Title</th><th>Message</th><th>Block</th><th>State</th><th>Time</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let n of notifications">
                  <td><span class="badge" [ngClass]="n.severity === 'critical' ? 'badge-danger' : (n.severity === 'warning' ? 'badge-warning' : 'badge-primary')">{{ n.severity | uppercase }}</span></td>
                  <td class="fw-bold">{{ n.title }}</td>
                  <td>{{ n.message }}</td>
                  <td class="font-monospace small">{{ n.block_height ?? 'mempool' }}</td>
                  <td><span class="badge badge-secondary">{{ n.state }}</span></td>
                  <td class="small text-muted text-nowrap">{{ n.created_at_utc | date:'short' }}</td>
                  <td><button *ngIf="n.state === 'open'" type="button" class="btn btn-sm btn-outline-secondary" [disabled]="busy" (click)="acknowledge(n.notification_id)">Acknowledge</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>
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
    .badge-warning { background-color: var(--warning, #ffc107); color: #212529; }
    .badge-danger { background-color: var(--danger, #dc3545); color: #fff; }
  `],
})
export class WatchlistsComponent implements OnInit, OnDestroy {
  watchlists: any[] = [];
  webhooks: any[] = [];
  notifications: any[] = [];
  loading = false;
  busy = false;
  loadError: string | null = null;
  newName = '';
  readonly entityTypes = ENTITY_TYPES;
  readonly conditionTypes = CONDITION_TYPES;
  entityType: Record<string, string> = {};
  entityRaw: Record<string, string> = {};
  entityLabel: Record<string, string> = {};
  ruleCondition: Record<string, string> = {};
  ruleThreshold: Record<string, number | null> = {};
  ruleChannel: Record<string, string> = {};
  ruleWebhook: Record<string, string> = {};

  private subs: Subscription[] = [];

  constructor(
    private api: IntelligenceApiService,
    private ownerKey: OwnerKeyService,
    private cdr: ChangeDetectorRef
  ) {}

  get hasKey(): boolean {
    return this.ownerKey.key !== null;
  }

  ngOnInit(): void {
    if (this.hasKey) { this.load(); this.loadWebhooks(); this.loadNotifications(); }
  }

  thresholdHint(condition: string): string {
    if (condition === 'feerate_cross') { return 'sat/vB'; }
    if (condition === 'value_transfer') { return 'min sats (optional)'; }
    return 'no threshold';
  }

  webhookLabel(webhookId: string | null): string {
    const hook = this.webhooks.find(w => w.webhook_id === webhookId);
    return hook ? hook.url : (webhookId || '');
  }

  loadWebhooks(): void {
    this.subs.push(this.api.getWebhooks$().subscribe({
      next: (res) => {
        this.webhooks = (res?.webhooks || []).filter((w: any) => w.active);
        for (const wl of this.watchlists) { this.ruleWebhook[wl.watchlist_id] ||= this.webhooks[0]?.webhook_id || ''; }
        this.cdr.markForCheck();
      },
      error: () => { this.webhooks = []; this.cdr.markForCheck(); },
    }));
  }

  removeEntity(watchlistId: string, entityId: string): void {
    this.run(this.api.deleteWatchlistEntity$(watchlistId, entityId), () => this.load());
  }

  removeRule(watchlistId: string, ruleId: string): void {
    this.run(this.api.deleteWatchlistRule$(watchlistId, ruleId), () => this.load());
  }

  private failure(err: any, fallback: string): string {
    if (err?.status === 401) { return 'The stored owner key was not accepted; create or paste a valid key in the Developer Platform.'; }
    return err?.error?.error || err?.message || fallback;
  }

  load(): void {
    this.loading = true;
    this.subs.push(this.api.getWatchlists$().subscribe({
      next: (res) => {
        this.watchlists = res?.watchlists || [];
        for (const wl of this.watchlists) {
          this.entityType[wl.watchlist_id] ??= 'address';
          this.ruleCondition[wl.watchlist_id] ??= 'confirmation';
          this.ruleChannel[wl.watchlist_id] ??= 'in_app';
          this.ruleWebhook[wl.watchlist_id] ||= this.webhooks[0]?.webhook_id || '';
        }
        this.loading = false;
        this.loadError = null;
        this.cdr.markForCheck();
      },
      error: (err) => { this.loadError = this.failure(err, 'Failed to fetch watchlists'); this.loading = false; this.cdr.markForCheck(); },
    }));
  }

  loadNotifications(): void {
    this.subs.push(this.api.getWatchlistNotifications$().subscribe({
      next: (res) => { this.notifications = res?.notifications || []; this.cdr.markForCheck(); },
      error: (err) => { this.loadError = this.failure(err, 'Failed to fetch notifications'); this.cdr.markForCheck(); },
    }));
  }

  private run(observable: { subscribe: Function }, after: () => void): void {
    this.busy = true;
    this.subs.push(observable.subscribe({
      next: () => { this.busy = false; this.loadError = null; after(); },
      error: (err: any) => { this.busy = false; this.loadError = this.failure(err, 'The request failed'); this.cdr.markForCheck(); },
    }));
  }

  create(): void {
    if (!this.newName.trim()) { return; }
    this.run(this.api.createWatchlist$(this.newName.trim()), () => { this.newName = ''; this.load(); });
  }

  remove(watchlistId: string): void {
    this.run(this.api.deleteWatchlist$(watchlistId), () => this.load());
  }

  addEntity(watchlistId: string): void {
    const raw = (this.entityRaw[watchlistId] || '').trim();
    if (!raw) { return; }
    this.run(this.api.addWatchlistEntity$(watchlistId, this.entityType[watchlistId] || 'address', raw, (this.entityLabel[watchlistId] || '').trim() || 'Monitored Item'), () => {
      this.entityRaw[watchlistId] = '';
      this.entityLabel[watchlistId] = '';
      this.load();
    });
  }

  addRule(watchlistId: string): void {
    const threshold = this.ruleThreshold[watchlistId];
    const channel = this.ruleChannel[watchlistId] || 'in_app';
    this.run(this.api.addWatchlistRule$(watchlistId, this.ruleCondition[watchlistId] || 'confirmation', channel, threshold === null || threshold === undefined ? undefined : Number(threshold), channel === 'webhook' ? (this.ruleWebhook[watchlistId] || '').trim() : undefined), () => this.load());
  }

  acknowledge(notificationId: string): void {
    this.run(this.api.acknowledgeNotification$(notificationId), () => this.loadNotifications());
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) { sub.unsubscribe(); }
  }
}
