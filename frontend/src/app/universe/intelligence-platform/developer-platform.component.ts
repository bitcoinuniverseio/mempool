import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';
import { OwnerKeyService } from './owner-key.service';

/** Scopes a key can be minted with; keys:manage is what lets a key mint others. */
export const KEY_SCOPES = ['read', 'watchlists', 'webhooks', 'queries', 'cases', 'knowledge', 'keys:manage', 'node:rpc'] as const;

/**
 * The developer platform: an owner and its keys and webhooks.
 *
 * The owner is whoever holds the key stored in this browser. Creating an
 * owner returns its first key once; every later call is signed with it.
 * Usage metrics are shown only when the backend has them, which it does
 * not on this deployment, and that is what the panel says.
 */
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
          Create an owner, mint scoped API keys, and register signed webhooks for watchlist notifications.
        </p>
      </header>

      <div *ngIf="loadError" class="alert alert-danger mb-4">{{ loadError }}</div>

      <!-- Owner -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Owner</h4>
          <button *ngIf="hasKey" type="button" class="btn btn-sm btn-outline-secondary" (click)="forgetKey()">Forget key on this device</button>
        </div>
        <div class="card-body">
          <div *ngIf="!hasKey">
            <p class="small text-muted">No owner key is held in this browser. Create an owner to receive a first key, or paste a key you already hold.</p>
            <div class="row g-3 align-items-end">
              <div class="col-md-5">
                <label class="form-label small text-muted" for="ownerName">Owner name</label>
                <input id="ownerName" type="text" class="form-control" [(ngModel)]="ownerName" placeholder="e.g. Ingestion service" />
              </div>
              <div class="col-md-3">
                <button type="button" class="btn btn-success w-100" [disabled]="!ownerName.trim() || busy" (click)="createOwner()">Create owner</button>
              </div>
              <div class="col-md-4">
                <label class="form-label small text-muted" for="pasteKey">Existing key</label>
                <div class="d-flex gap-2">
                  <input id="pasteKey" type="password" class="form-control font-monospace" [(ngModel)]="pastedKey" placeholder="uip_live_..." />
                  <button type="button" class="btn btn-outline-primary" [disabled]="!pastedKey.startsWith('uip_live_')" (click)="useKey()">Use</button>
                </div>
              </div>
            </div>
          </div>
          <div *ngIf="hasKey" class="small">
            Owner <code class="text-break">{{ ownerId || 'resolved from the stored key' }}</code>, key held in this browser only.
          </div>
          <div *ngIf="generatedKeySecret" class="alert alert-warning mt-3 mb-0">
            <strong>Save this key now.</strong> It is shown once and is not stored on the server:
            <div class="font-monospace fw-bold mt-1 text-break">{{ generatedKeySecret }}</div>
          </div>
        </div>
      </section>

      <ng-container *ngIf="hasKey">
        <!-- Usage -->
        <section class="alert mb-4" [ngClass]="usage ? 'alert-secondary' : 'alert-warning'">
          <ng-container *ngIf="usage; else noUsage">
            Requests this month: {{ usage.monthly_requests | number }}.
          </ng-container>
          <ng-template #noUsage>
            <strong>Usage metrics unavailable.</strong> The API gateway metrics store is not connected on this deployment.
          </ng-template>
        </section>

        <!-- API keys -->
        <section class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <h4 class="mb-0">API Keys</h4>
            <button type="button" class="btn btn-sm btn-primary" (click)="showNewKeyForm = !showNewKeyForm">
              {{ showNewKeyForm ? 'Cancel' : 'Mint key' }}
            </button>
          </div>
          <div class="card-body" *ngIf="showNewKeyForm">
            <div class="p-3 rounded bg-dark-subtle">
              <div class="row g-3 align-items-end">
                <div class="col-md-6">
                  <label class="form-label small text-muted" for="newKeyLabelInput">Key name</label>
                  <input id="newKeyLabelInput" type="text" class="form-control" [(ngModel)]="newKeyLabel" placeholder="e.g. Read-only dashboard" />
                </div>
                <div class="col-md-6">
                  <div class="small text-muted mb-1">Scopes (a subset of this key's scopes)</div>
                  <label class="me-3 small" *ngFor="let scope of scopes">
                    <input type="checkbox" [checked]="selectedScopes.has(scope)" (change)="toggleScope(scope)" /> {{ scope }}
                  </label>
                </div>
                <div class="col-12">
                  <button type="button" class="btn btn-success" [disabled]="!newKeyLabel.trim() || selectedScopes.size === 0 || busy" (click)="createKey()">Mint key</button>
                </div>
              </div>
            </div>
          </div>
          <div *ngIf="!loading && keys.length === 0" class="p-4 text-center text-muted">No keys listed for this owner.</div>
          <div class="table-responsive" *ngIf="keys.length > 0" tabindex="0" role="region" aria-label="API keys, scroll horizontally" i18n-aria-label>
            <table class="table table-hover mb-0">
              <thead>
                <tr><th>Name</th><th>Scopes</th><th>Created</th><th>Last used</th><th>State</th><th></th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let key of keys">
                  <td>{{ key.name }}<div class="font-monospace small text-muted text-break">{{ key.key_id }}</div></td>
                  <td class="scopes"><span *ngFor="let s of key.scopes" class="badge badge-secondary me-1 mb-1">{{ s }}</span></td>
                  <td class="small text-muted text-nowrap">{{ key.created_at | date:'short' }}</td>
                  <td class="small text-muted text-nowrap">{{ key.last_used_at ? (key.last_used_at | date:'short') : 'never' }}</td>
                  <td><span class="badge" [ngClass]="key.revoked ? 'badge-secondary' : 'badge-success'">{{ key.revoked ? 'REVOKED' : 'ACTIVE' }}</span></td>
                  <td><button *ngIf="!key.revoked" type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy" (click)="revokeKey(key.key_id)">Revoke</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Webhooks -->
        <section class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <h4 class="mb-0">Webhooks</h4>
            <button type="button" class="btn btn-sm btn-primary" (click)="showNewWebhookForm = !showNewWebhookForm">
              {{ showNewWebhookForm ? 'Cancel' : 'Register webhook' }}
            </button>
          </div>
          <div class="card-body" *ngIf="showNewWebhookForm">
            <div class="p-3 rounded bg-dark-subtle">
              <div class="row g-3 align-items-end">
                <div class="col-md-9">
                  <label class="form-label small text-muted" for="webhookUrl">HTTPS endpoint (public address; private and loopback targets are refused)</label>
                  <input id="webhookUrl" type="url" class="form-control font-monospace" [(ngModel)]="newWebhookUrl" placeholder="https://hooks.example.org/universe" />
                </div>
                <div class="col-md-3">
                  <button type="button" class="btn btn-success w-100" [disabled]="!newWebhookUrl.startsWith('https://') || busy" (click)="registerWebhook()">Register</button>
                </div>
              </div>
              <div *ngIf="generatedWebhookSecret" class="alert alert-warning mt-3 mb-0">
                <strong>Signing secret, shown once.</strong> Verify <code>X-Universe-Signature</code> as HMAC-SHA256 of <code>timestamp.body</code>:
                <div class="font-monospace fw-bold mt-1 text-break">{{ generatedWebhookSecret }}</div>
              </div>
            </div>
          </div>
          <div *ngIf="!loading && webhooks.length === 0" class="p-4 text-center text-muted">No webhooks registered for this owner.</div>
          <div class="table-responsive" *ngIf="webhooks.length > 0" tabindex="0" role="region" aria-label="Webhooks, scroll horizontally" i18n-aria-label>
            <table class="table table-hover mb-0">
              <thead>
                <tr><th>Endpoint</th><th>Events</th><th>State</th><th>Deliveries</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let w of webhooks">
                  <td class="font-monospace small text-break">{{ w.url }}<div class="text-muted">{{ w.webhook_id }}</div></td>
                  <td><span *ngFor="let ev of w.event_filters" class="badge badge-primary me-1">{{ ev }}</span></td>
                  <td><span class="badge" [ngClass]="w.active ? 'badge-success' : 'badge-secondary'">{{ w.active ? 'ACTIVE' : 'DISABLED' }}</span></td>
                  <td>
                    <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadAttempts(w.webhook_id)">Show attempts</button>
                    <div *ngIf="attempts[w.webhook_id]" class="small mt-2">
                      <div *ngIf="attempts[w.webhook_id].length === 0" class="text-muted">No delivery attempted yet.</div>
                      <div *ngFor="let a of attempts[w.webhook_id]" class="font-monospace">
                        #{{ a.attempt_number }} {{ a.started_at | date:'short' }}
                        <span [ngClass]="a.success ? 'text-success' : 'text-danger'">{{ a.success ? 'delivered' : (a.error_code || 'failed') }}</span>
                        <span *ngIf="a.status_code !== null"> http {{ a.status_code }}</span>
                      </div>
                    </div>
                  </td>
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
    td.scopes { max-width: 26rem; white-space: normal; }
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
  attempts: Record<string, any[]> = {};
  usage: any = null;
  loading = false;
  busy = false;
  loadError: string | null = null;
  ownerName = '';
  pastedKey = '';
  ownerId: string | null = null;
  generatedKeySecret: string | null = null;
  generatedWebhookSecret: string | null = null;
  showNewKeyForm = false;
  showNewWebhookForm = false;
  newKeyLabel = '';
  newWebhookUrl = '';
  readonly scopes = KEY_SCOPES;
  selectedScopes = new Set<string>(['read']);

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
    if (this.hasKey) { this.refresh(); }
  }

  private failure(err: any, fallback: string): string {
    if (err?.status === 401) { return 'The stored key was not accepted. Forget it on this device and create or paste a valid key.'; }
    return err?.error?.error || err?.message || fallback;
  }

  refresh(): void {
    this.loading = true;
    this.loadError = null;
    this.subs.push(this.api.getDeveloperKeys$().subscribe({
      next: (res) => {
        this.keys = res?.keys || [];
        this.ownerId = this.keys[0]?.owner_id ?? this.ownerId;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => { this.loadError = this.failure(err, 'Failed to fetch developer keys'); this.loading = false; this.cdr.markForCheck(); },
    }));
    this.subs.push(this.api.getWebhooks$().subscribe({
      next: (res) => { this.webhooks = res?.webhooks || []; this.cdr.markForCheck(); },
      error: () => { this.webhooks = []; this.cdr.markForCheck(); },
    }));
    // Usage is shown only when the backend measures it; a 503 says it does not.
    this.subs.push(this.api.getDeveloperUsage$().subscribe({
      next: (res) => { this.usage = res && typeof res.monthly_requests === 'number' ? res : null; this.cdr.markForCheck(); },
      error: () => { this.usage = null; this.cdr.markForCheck(); },
    }));
  }

  createOwner(): void {
    if (!this.ownerName.trim()) { return; }
    this.busy = true;
    this.subs.push(this.api.createOwner$(this.ownerName.trim()).subscribe({
      next: (res) => {
        this.busy = false;
        if (typeof res?.secret_key !== 'string') { this.loadError = 'The server did not return a key.'; this.cdr.markForCheck(); return; }
        this.generatedKeySecret = res.secret_key;
        this.ownerId = res.owner_id ?? null;
        this.ownerKey.set(res.secret_key);
        this.ownerName = '';
        this.refresh();
      },
      error: (err) => { this.busy = false; this.loadError = this.failure(err, 'Owner creation failed'); this.cdr.markForCheck(); },
    }));
  }

  useKey(): void {
    this.ownerKey.set(this.pastedKey.trim());
    this.pastedKey = '';
    this.refresh();
  }

  forgetKey(): void {
    this.ownerKey.clear();
    this.keys = [];
    this.webhooks = [];
    this.usage = null;
    this.ownerId = null;
    this.generatedKeySecret = null;
    this.generatedWebhookSecret = null;
    this.cdr.markForCheck();
  }

  toggleScope(scope: string): void {
    if (this.selectedScopes.has(scope)) { this.selectedScopes.delete(scope); } else { this.selectedScopes.add(scope); }
  }

  createKey(): void {
    if (!this.newKeyLabel.trim() || this.selectedScopes.size === 0) { return; }
    this.busy = true;
    this.subs.push(this.api.generateDeveloperKey$(this.newKeyLabel.trim(), [...this.selectedScopes]).subscribe({
      next: (res) => {
        this.busy = false;
        if (typeof res?.secret_key !== 'string') { this.loadError = 'The server did not return a key.'; this.cdr.markForCheck(); return; }
        this.generatedKeySecret = res.secret_key;
        this.newKeyLabel = '';
        this.showNewKeyForm = false;
        this.refresh();
      },
      error: (err) => { this.busy = false; this.loadError = this.failure(err, 'Key creation failed'); this.cdr.markForCheck(); },
    }));
  }

  revokeKey(keyId: string): void {
    this.busy = true;
    this.subs.push(this.api.revokeDeveloperKey$(keyId).subscribe({
      next: () => { this.busy = false; this.refresh(); },
      error: (err) => { this.busy = false; this.loadError = this.failure(err, 'Revocation failed'); this.cdr.markForCheck(); },
    }));
  }

  registerWebhook(): void {
    this.busy = true;
    this.subs.push(this.api.registerWebhook$(this.newWebhookUrl.trim(), ['watchlist.notification']).subscribe({
      next: (res) => {
        this.busy = false;
        this.generatedWebhookSecret = typeof res?.signing_secret === 'string' ? res.signing_secret : null;
        this.newWebhookUrl = '';
        this.refresh();
      },
      error: (err) => { this.busy = false; this.loadError = this.failure(err, 'Webhook registration failed'); this.cdr.markForCheck(); },
    }));
  }

  loadAttempts(webhookId: string): void {
    this.subs.push(this.api.getWebhookAttempts$(webhookId).subscribe({
      next: (res) => { this.attempts = { ...this.attempts, [webhookId]: res?.attempts || [] }; this.cdr.markForCheck(); },
      error: (err) => { this.loadError = this.failure(err, 'Failed to fetch delivery attempts'); this.cdr.markForCheck(); },
    }));
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) { sub.unsubscribe(); }
  }
}
