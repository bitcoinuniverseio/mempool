import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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

      <!-- Usage Analytics Cards -->
      <section class="row g-3 mb-4">
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">30-Day Requests</div>
            <div class="h3 my-1 text-primary">124,500</div>
            <div class="small text-muted">875,500 remaining quota</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">p95 Latency</div>
            <div class="h3 my-1 text-success">42 ms</div>
            <div class="small text-muted">Fast edge cache responses</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">Error Rate</div>
            <div class="h3 my-1 text-success">0.02%</div>
            <div class="small text-muted">High availability SLA</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">Rate Limit</div>
            <div class="h3 my-1">60 req/min</div>
            <div class="small text-muted">Standard developer tier</div>
          </div>
        </div>
      </section>

      <!-- API Key Management -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h4 class="mb-0">Active API Keys</h4>
          <button class="btn btn-sm btn-primary" (click)="showNewKeyModal = !showNewKeyModal">
            Generate New Key
          </button>
        </div>
        <div class="card-body" *ngIf="showNewKeyModal">
          <div class="p-3 rounded bg-dark-subtle mb-3">
            <h5 class="mb-2">Create Scoped API Key</h5>
            <div class="row g-3 align-items-end">
              <div class="col-md-8">
                <label class="form-label small text-muted">Key Label</label>
                <input
                  type="text"
                  class="form-control"
                  [(ngModel)]="newKeyLabel"
                  placeholder="e.g. Production Ingestion Service"
                />
              </div>
              <div class="col-md-4">
                <button class="btn btn-success w-100" (click)="createKey()">Generate Key</button>
              </div>
            </div>
            <div *ngIf="generatedKeySecret" class="alert alert-warning mt-3 mb-0">
              <strong>Save your secret key now!</strong> It will not be shown again:
              <div class="font-monospace fw-bold mt-1">{{ generatedKeySecret }}</div>
            </div>
          </div>
        </div>
        <div class="table-responsive">
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
                <td class="font-monospace fw-bold">{{ key.key_id }}</td>
                <td>{{ key.name }}</td>
                <td>
                  <span *ngFor="let s of key.scopes" class="badge badge-secondary me-1">{{ s }}</span>
                </td>
                <td class="font-monospace">{{ key.prefix }}...</td>
                <td class="small text-muted">{{ key.created_at | date:'short' }}</td>
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
    .badge-secondary { background-color: #6c757d; color: #fff; }
    .badge-success { background-color: #198754; color: #fff; }
  `],
})
export class DeveloperPlatformComponent implements OnInit {
  keys: any[] = [];
  showNewKeyModal = false;
  newKeyLabel = '';
  generatedKeySecret: string | null = null;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadKeys();
  }

  loadKeys(): void {
    this.api.getDeveloperKeys$().subscribe((res) => {
      this.keys = res?.keys || [];
      this.cdr.markForCheck();
    });
  }

  createKey(): void {
    if (!this.newKeyLabel.trim()) return;
    this.api.generateDeveloperKey$(this.newKeyLabel, ['read', 'webhook']).subscribe((res) => {
      this.generatedKeySecret = res.secret_key;
      this.newKeyLabel = '';
      this.loadKeys();
      this.cdr.markForCheck();
    });
  }
}
