import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-knowledge-registry',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Evidence-Backed Labels & Public Knowledge Registry</h1>
          <span class="badge badge-success" *ngIf="labels.length > 0">
            {{ verifiedCount }} Verified Attributions
          </span>
          <span class="badge badge-secondary" *ngIf="loading">
            Loading Knowledge Registry...
          </span>
        </div>
        <p class="subtitle">
          Transparent public label registry where every entity attribution is backed by immutable cryptographic proof, on-chain signatures, or verifiable disclosures.
        </p>
      </header>

      <div *ngIf="loadError" class="alert alert-danger mb-4">
        {{ loadError }}
      </div>

      <!-- Labels Grid -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Entity Labels</h4>
          <div class="d-flex gap-2 align-items-center">
            <input
              type="text"
              class="form-control form-control-sm"
              placeholder="Filter labels or addresses..."
              [(ngModel)]="searchFilter"
              aria-label="Filter labels"
            />
          </div>
        </div>

        <div *ngIf="!loading && filteredLabels.length === 0 && !loadError" class="p-4 text-center text-muted">
          No entity labels match the selected criteria.
        </div>

        <div class="table-responsive" *ngIf="filteredLabels.length > 0">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Entity Label</th>
                <th>Target Identifier</th>
                <th>Category</th>
                <th>Confidence</th>
                <th>Primary Evidence Citation</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let label of filteredLabels">
                <td class="fw-bold">{{ label.name }}</td>
                <td class="font-monospace small text-break">{{ label.entity_id }}</td>
                <td><span class="badge badge-secondary text-uppercase">{{ label.category }}</span></td>
                <td>
                  <span class="badge badge-primary">
                    Level {{ label.confidence_level }} ({{ (label.confidence_score * 100).toFixed(0) }}%)
                  </span>
                </td>
                <td class="small">
                  <div *ngIf="label.evidence?.length > 0">
                    <strong>{{ label.evidence[0].evidence_type }}</strong>
                    <div class="text-muted">{{ label.evidence[0].description }}</div>
                  </div>
                  <div *ngIf="!label.evidence || label.evidence.length === 0" class="text-muted">
                    No citation attached
                  </div>
                </td>
                <td>
                  <span class="badge" [ngClass]="label.status === 'verified' ? 'badge-success' : 'badge-warning'">
                    {{ label.status | uppercase }}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-primary"
                    (click)="selectedEvidence = label"
                  >
                    Evidence
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Evidence Detail Drawer / Section -->
      <section class="card mb-4 border-info" *ngIf="selectedEvidence">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h5 class="mb-0">Evidence Citations for {{ selectedEvidence.name }}</h5>
          <button type="button" class="btn btn-sm btn-outline-secondary" (click)="selectedEvidence = null">
            Close
          </button>
        </div>
        <div class="card-body">
          <div *ngFor="let ev of selectedEvidence.evidence" class="p-3 rounded bg-dark-subtle mb-2">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <strong>{{ ev.evidence_type }}</strong>
              <span class="badge badge-secondary font-monospace">{{ ev.evidence_id }}</span>
            </div>
            <p class="small mb-1">{{ ev.description }}</p>
            <div *ngIf="ev.uri" class="small">
              <a [href]="ev.uri" target="_blank" rel="noopener" class="text-break">{{ ev.uri }}</a>
            </div>
          </div>
        </div>
      </section>

      <!-- Public Audit Trail -->
      <section class="card mb-4" *ngIf="auditLog.length > 0">
        <div class="card-header">
          <h4 class="mb-0">Public Attribution Audit Trail</h4>
        </div>
        <div class="table-responsive">
          <table class="table table-sm table-hover mb-0">
            <thead>
              <tr>
                <th>Action</th>
                <th>Actor</th>
                <th>Evidence Summary</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let a of auditLog">
                <td><span class="badge badge-secondary text-uppercase">{{ a.action }}</span></td>
                <td class="font-monospace small text-break">{{ a.actor_id }}</td>
                <td class="small">{{ a.evidence_summary }}</td>
                <td class="small text-muted">{{ a.timestamp_utc | date:'short' }}</td>
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
    .badge-success { background-color: var(--success, #198754); color: #fff; }
    .badge-warning { background-color: var(--warning, #ffc107); color: #000; }
    .badge-secondary { background-color: var(--secondary, #6c757d); color: #fff; }
  `],
})
export class KnowledgeRegistryComponent implements OnInit, OnDestroy {
  labels: any[] = [];
  auditLog: any[] = [];
  searchFilter = '';
  selectedEvidence: any = null;
  loading = false;
  loadError: string | null = null;

  private subs: Subscription[] = [];

  get verifiedCount(): number {
    return this.labels.filter((l) => l.status === 'verified').length;
  }

  get filteredLabels(): any[] {
    const q = this.searchFilter.trim().toLowerCase();
    if (!q) return this.labels;
    return this.labels.filter(
      (l) =>
        (l.name && l.name.toLowerCase().includes(q)) ||
        (l.entity_id && l.entity_id.toLowerCase().includes(q)) ||
        (l.category && l.category.toLowerCase().includes(q))
    );
  }

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loading = true;
    this.subs.push(
      this.api.getKnowledgeLabels$().subscribe({
        next: (res) => {
          this.labels = res?.labels || [];
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loadError = err?.message || 'Failed to fetch knowledge labels';
          this.loading = false;
          this.cdr.markForCheck();
        },
      })
    );

    this.subs.push(
      this.api.getKnowledgeAuditLog$().subscribe({
        next: (res) => {
          this.auditLog = res?.audit_events || [];
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
