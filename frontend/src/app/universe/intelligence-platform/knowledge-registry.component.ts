import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
          <span class="badge badge-success">Cryptographic Evidence Enforced</span>
        </div>
        <p class="subtitle">
          Transparent public label registry where every entity attribution is backed by immutable cryptographic proof, on-chain signatures, or verifiable disclosures.
        </p>
      </header>

      <!-- Labels Grid -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h4 class="mb-0">Verified Entity Labels</h4>
          <span class="small text-muted">Zero black-box clusters • Audited changes</span>
        </div>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Entity Label</th>
                <th>Target Identifier</th>
                <th>Category</th>
                <th>Confidence</th>
                <th>Primary Evidence Citation</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let label of labels">
                <td class="fw-bold">{{ label.name }}</td>
                <td class="font-monospace small">{{ label.entity_id }}</td>
                <td><span class="badge badge-secondary text-uppercase">{{ label.category }}</span></td>
                <td>
                  <span class="badge badge-primary">
                    Level {{ label.confidence_level }} ({{ (label.confidence_score * 100).toFixed(0) }}%)
                  </span>
                </td>
                <td class="small">
                  <div *ngIf="label.evidence.length > 0">
                    <strong>{{ label.evidence[0].evidence_type }}</strong>
                    <div class="text-muted">{{ label.evidence[0].description }}</div>
                  </div>
                </td>
                <td>
                  <span class="badge" [ngClass]="label.status === 'verified' ? 'badge-success' : 'badge-warning'">
                    {{ label.status | uppercase }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
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
                <td class="font-monospace small">{{ a.actor_id }}</td>
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
    .badge-primary { background-color: #0d6efd; color: #fff; }
    .badge-success { background-color: #198754; color: #fff; }
    .badge-secondary { background-color: #6c757d; color: #fff; }
    .badge-warning { background-color: #ffc107; color: #000; }
  `],
})
export class KnowledgeRegistryComponent implements OnInit {
  labels: any[] = [];
  auditLog: any[] = [];

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.getKnowledgeLabels$().subscribe((res) => {
      this.labels = res?.labels || [];
      this.cdr.markForCheck();
    });

    this.api.getKnowledgeAuditLog$().subscribe((res) => {
      this.auditLog = res?.audit_log || [];
      this.cdr.markForCheck();
    });
  }
}
