import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-incident-center',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Consensus Incident and Reorganization Center</h1>
          <span class="badge badge-success">Consensus Rules Aligned</span>
        </div>
        <p class="subtitle">
          Timeline of detected chain reorganizations, candidate invalid blocks, and consensus divergences observed across Universe self-hosted nodes.
        </p>
      </header>

      <section class="incidents-list">
        <div *ngFor="let incident of incidents" class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <span class="badge" [ngClass]="incident.status === 'resolved' ? 'badge-success' : 'badge-warning'">
                {{ incident.status | uppercase }}
              </span>
              <span class="badge badge-secondary ms-2 text-uppercase">{{ incident.incident_type }}</span>
              <h4 class="mt-2 mb-0">{{ incident.title }}</h4>
            </div>
            <div class="text-muted small">
              Detected: {{ incident.detected_at_utc | date:'medium' }}
            </div>
          </div>
          <div class="card-body">
            <p class="lead mb-3">{{ incident.summary }}</p>

            <div class="row text-center g-3 mb-3">
              <div class="col-md-3 col-6">
                <div class="p-2 rounded bg-dark-subtle">
                  <div class="small text-muted">Block Height</div>
                  <div class="fw-bold">{{ incident.block_height | number }}</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-2 rounded bg-dark-subtle">
                  <div class="small text-muted">Reorg Depth</div>
                  <div class="fw-bold text-warning">{{ incident.reorg_depth }} Blocks</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-2 rounded bg-dark-subtle">
                  <div class="small text-muted">Displaced Transactions</div>
                  <div class="fw-bold">{{ incident.displaced_tx_count | number }}</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-2 rounded bg-dark-subtle">
                  <div class="small text-muted">Resolution Time</div>
                  <div class="fw-bold text-success">{{ incident.duration_seconds }}s</div>
                </div>
              </div>
            </div>

            <div class="p-3 rounded bg-dark-subtle">
              <h6 class="text-uppercase small text-muted mb-1">Technical Post-Mortem:</h6>
              <p class="small mb-0">{{ incident.technical_postmortem }}</p>
            </div>
          </div>
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
    .badge-success { background-color: #198754; color: #fff; }
    .badge-warning { background-color: #ffc107; color: #000; }
    .badge-secondary { background-color: #6c757d; color: #fff; }
  `],
})
export class IncidentCenterComponent implements OnInit {
  incidents: any[] = [];

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.getIncidents$().subscribe((res) => {
      this.incidents = res?.incidents || [];
      this.cdr.markForCheck();
    });
  }
}
