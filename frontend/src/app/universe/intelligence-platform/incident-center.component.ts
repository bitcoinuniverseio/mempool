import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
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
          <span class="badge badge-success" *ngIf="!loading && activeIncidentsCount === 0">
            Consensus Rules Aligned
          </span>
          <span class="badge badge-warning" *ngIf="!loading && activeIncidentsCount > 0">
            {{ activeIncidentsCount }} Active Divergences
          </span>
          <span class="badge badge-secondary" *ngIf="loading">
            Syncing Incident Records...
          </span>
        </div>
        <p class="subtitle">
          Timeline of detected chain reorganizations, candidate invalid blocks, and consensus divergences observed across Universe self-hosted nodes.
        </p>
      </header>

      <div *ngIf="loadError" class="alert alert-danger mb-4">
        {{ loadError }}
      </div>

      <div *ngIf="!loading && incidents.length === 0 && !loadError" class="p-4 rounded bg-dark-subtle text-muted text-center mb-4">
        No active consensus incidents or chain reorganizations detected across monitored nodes.
      </div>

      <section class="incidents-list" *ngIf="incidents.length > 0">
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
                <div class="p-2 rounded bg-dark-subtle h-100">
                  <div class="small text-muted">Block Height</div>
                  <div class="fw-bold">{{ incident.block_height | number }}</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-2 rounded bg-dark-subtle h-100">
                  <div class="small text-muted">Reorg Depth</div>
                  <div class="fw-bold text-warning">{{ incident.reorg_depth }} Blocks</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-2 rounded bg-dark-subtle h-100">
                  <div class="small text-muted">Displaced Transactions</div>
                  <div class="fw-bold">{{ incident.displaced_tx_count | number }}</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-2 rounded bg-dark-subtle h-100">
                  <div class="small text-muted">Resolution Time</div>
                  <div class="fw-bold text-success">{{ incident.duration_seconds }}s</div>
                </div>
              </div>
            </div>

            <div class="p-3 rounded bg-dark-subtle" *ngIf="incident.technical_postmortem">
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
    .badge-success { background-color: var(--success, #198754); color: #fff; }
    .badge-warning { background-color: var(--warning, #ffc107); color: #000; }
    .badge-secondary { background-color: var(--secondary, #6c757d); color: #fff; }
  `],
})
export class IncidentCenterComponent implements OnInit, OnDestroy {
  incidents: any[] = [];
  loading = false;
  loadError: string | null = null;

  private sub?: Subscription;

  get activeIncidentsCount(): number {
    return this.incidents.filter((i) => i.status !== 'resolved').length;
  }

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loading = true;
    this.sub = this.api.getIncidents$().subscribe({
      next: (res) => {
        this.incidents = res?.incidents || [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loadError = err?.message || 'Failed to fetch consensus incident records';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
