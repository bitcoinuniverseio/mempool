import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, distinctUntilChanged, map, startWith, timeout } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';
import { StateService } from '@app/services/state.service';
import { checkedKnowledgeAudit, checkedKnowledgeLabels, KnowledgeAudit, KnowledgeLabel } from './knowledge-evidence';

@Component({
  selector: 'app-knowledge-registry',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Knowledge Registry</h1>
          <span class="badge badge-success" *ngIf="labels.length > 0">
            {{ verifiedCount }} verified
          </span>
          <span class="badge badge-secondary" *ngIf="loading">
            Loading...
          </span>
        </div>
        <p class="subtitle">
          Entity labels with the evidence behind each one.
        </p>
        <p>Showing up to 200 returned labels and audit entries. This is a bounded view, not a complete attribution catalogue. A reported label status does not establish address ownership or verify a submitted cryptographic proof.</p>
      </header>

      <div *ngIf="loadError" class="alert alert-danger mb-4" role="alert">
        {{ loadError }}
      </div>
      <p *ngIf="auditError" class="alert alert-warning" role="alert">{{ auditError }}</p>
      <p *ngIf="auditLoading" role="status">Reading the selected network audit trail…</p>
      <p *ngIf="!auditLoading && !auditError && auditLog.length === 0">No audit entries returned for this network.</p>
      <button *ngIf="loadError || auditError" type="button" class="btn btn-outline-primary mb-3" (click)="reload()">Retry knowledge reads</button>

      <!-- Labels Grid -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Labels <span class="text-muted small fw-normal" *ngIf="labels.length">{{ filteredLabels.length | number }} of {{ labels.length | number }}</span></h4>
          <div class="d-flex gap-2 align-items-center">
            <input
              type="text"
              class="form-control form-control-sm"
              placeholder="Filter"
              [(ngModel)]="searchFilter"
              aria-label="Filter labels"
            />
          </div>
        </div>

        <div *ngIf="!loading && filteredLabels.length === 0 && !loadError" class="p-4 text-center text-muted">
          No label matches.
        </div>

        <div class="table-responsive" *ngIf="filteredLabels.length > 0" tabindex="0" role="region" aria-label="Entity Labels, scroll horizontally" i18n-aria-label>
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
              <tr *ngFor="let label of filteredLabels | slice:0:visibleCount">
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
        <div class="p-2 text-center" *ngIf="filteredLabels.length > visibleCount">
          <button type="button" class="btn btn-sm btn-outline-secondary" (click)="showMore()">Show more ({{ filteredLabels.length - visibleCount | number }} left)</button>
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
            </div>
            <p class="small mb-1">{{ ev.description }}</p>
            <div class="small">
              <a *ngIf="referenceHref(ev.reference_uri) as href; else plainReference" [href]="href" target="_blank" rel="noopener noreferrer" class="text-break">{{ ev.reference_uri }}</a>
              <ng-template #plainReference><code class="text-break">{{ ev.reference_uri || 'No public reference supplied.' }}</code></ng-template>
            </div>
          </div>
        </div>
      </section>

      <!-- Public Audit Trail -->
      <section class="card mb-4" *ngIf="auditLog.length > 0">
        <div class="card-header">
          <h4 class="mb-0">Public Attribution Audit Trail</h4>
        </div>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Public Attribution Audit Trail, scroll horizontally" i18n-aria-label>
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
  labels: KnowledgeLabel[] = [];
  auditLog: KnowledgeAudit[] = [];
  searchFilter = '';
  selectedEvidence: KnowledgeLabel | null = null;
  loading = false;
  loadError: string | null = null;
  auditError: string | null = null;
  auditLoading = false;

  private subs: Subscription[] = [];
  private contextSubscription?: Subscription;
  private revision = 0;
  private destroyed = false;

  visibleCount = 50;

  showMore(): void { this.visibleCount += 100; }

  get verifiedCount(): number {
    return this.labels.filter((l) => l.status === 'verified').length;
  }

  get filteredLabels(): KnowledgeLabel[] {
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
    private cdr: ChangeDetectorRef,
    private state: StateService
  ) {}

  ngOnInit(): void {
    this.contextSubscription = this.state.networkChanged$.pipe(map(() => this.selectedNetwork()), startWith(this.selectedNetwork()), distinctUntilChanged()).subscribe(() => this.reload());
  }

  private selectedNetwork(): string { return this.state.network || this.state.env.ROOT_NETWORK || 'mainnet'; }

  referenceHref(value: string): string | null {
    try { const url=new URL(value);return ['https:','http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
  }

  reload(): void {
    if (this.destroyed) { return; }
    this.subs.forEach(sub => sub.unsubscribe());this.subs=[];
    const revision=++this.revision, network=this.selectedNetwork();
    const current=(): boolean => !this.destroyed && revision===this.revision && network===this.selectedNetwork();
    this.labels=[];this.auditLog=[];this.selectedEvidence=null;this.visibleCount=50;
    this.loadError=null;this.auditError=null;
    this.loading = true;
    this.auditLoading = true;
    this.subs.push(
      this.api.getKnowledgeLabels$().pipe(timeout({first:10000})).subscribe({
        next: (res) => {
          if (!current()) { return; }
          try { this.labels=checkedKnowledgeLabels(res,network); }
          catch { this.labels=[];this.selectedEvidence=null;this.loadError='The selected network returned malformed or mismatched knowledge evidence.'; }
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          if (!current()) { return; }
          this.labels=[];this.selectedEvidence=null;
          this.loadError = 'The selected network knowledge labels are unavailable.';
          this.loading = false;
          this.cdr.markForCheck();
        },
      })
    );

    this.subs.push(
      this.api.getKnowledgeAuditLog$().pipe(timeout({first:10000})).subscribe({
        next: (res) => {
          if (!current()) { return; }
          try { this.auditLog=checkedKnowledgeAudit(res,network); }
          catch { this.auditLog=[];this.auditError='The selected network returned malformed or mismatched audit evidence.'; }
          this.auditLoading=false;
          this.cdr.markForCheck();
        },
        error: () => {
          if (!current()) { return; }
          this.auditLog=[];this.auditError='The selected network audit trail is unavailable.';
          this.auditLoading=false;
          this.cdr.markForCheck();
        },
      })
    );
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.destroyed=true;++this.revision;this.contextSubscription?.unsubscribe();
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
    this.subs=[];this.labels=[];this.auditLog=[];this.selectedEvidence=null;this.loading=false;this.auditLoading=false;
  }
}
