import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { IntelligenceApiService } from './intelligence-api.service';
import { StateService } from '@app/services/state.service';

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
          <span class="badge badge-secondary" *ngIf="!loading && !loadError && observed">
            {{ activeIncidentsCount }} active retained incident records
          </span>
          <span class="badge badge-warning" *ngIf="!loading && activeIncidentsCount > 0">
            {{ activeIncidentsCount }} active incident records
          </span>
          <span class="badge badge-secondary" *ngIf="loading">
            Syncing Incident Records...
          </span>
        </div>
        <p class="subtitle">
          Timeline of detected chain reorganizations, candidate invalid blocks, and consensus divergences observed across Universe self-hosted nodes.
        </p>
        <p class="small text-muted">Source identity and monitoring coverage are not reported by this response.</p>
      </header>

      <div *ngIf="loadError" class="alert alert-danger mb-4">
        {{ loadError }}
      </div>

      <div *ngIf="!loading && incidents.length === 0 && !loadError" class="p-4 rounded bg-dark-subtle text-muted text-center mb-4">
        No incident records returned by the selected source. This does not establish consensus agreement or complete monitoring coverage.
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
  observed = false;

  private sub?: Subscription;
  private networkSub?: Subscription;
  private revision = 0;
  private destroyed = false;

  get activeIncidentsCount(): number {
    return this.incidents.filter((i) => i.status !== 'resolved').length;
  }

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef,
    private stateService: StateService = null
  ) {}

  ngOnInit(): void {
    this.networkSub = this.stateService?.networkChanged$?.subscribe(() => this.load());
    this.load();
  }

  private get network(): string { return this.stateService?.network || this.stateService?.env?.ROOT_NETWORK || 'mainnet'; }

  private load(): void {
    if (this.destroyed) return;
    const revision = ++this.revision, network = this.network;
    this.sub?.unsubscribe();
    this.incidents = [];
    this.loadError = null;
    this.observed = false;
    this.loading = true;
    this.sub = this.api.getIncidents$().subscribe({
      next: (res) => {
        if (this.destroyed || revision !== this.revision || network !== this.network) return;
        if (!res || !Array.isArray(res.incidents) || res.incidents.length > 10000 ||
            !Number.isSafeInteger(res.count) || res.count !== res.incidents.length ||
            res.incidents.some((incident: any) => !validIncident(incident))) {
          this.loadError = 'The selected incident source returned an invalid or incomplete response.';
          this.incidents = [];
        } else {
          this.incidents = res.incidents;
          this.observed = true;
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (this.destroyed || revision !== this.revision || network !== this.network) return;
        this.incidents = [];
        this.observed = false;
        this.loadError = err?.error?.error || loadFailureMessage(classifyLoadFailure(err));
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.revision;
    this.sub?.unsubscribe();
    this.networkSub?.unsubscribe();
  }
}

function validIncident(value: any): boolean {
  const text = (field: string) => typeof value?.[field] === 'string' && value[field].length <= 65536;
  const integer = (field: string) => Number.isSafeInteger(value?.[field]) && value[field] >= 0;
  const utc = (field: string) => {
    if (!text(field) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value[field])) return false;
    const parsed = Date.parse(value[field]);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value[field].slice(0, 19);
  };
  return value && ['incident_id', 'title', 'summary', 'technical_postmortem'].every(text) &&
    ['reorg', 'invalid_block', 'stale_tip', 'consensus_divergence'].includes(value.incident_type) &&
    ['resolved', 'investigating', 'mitigated'].includes(value.status) &&
    typeof value.block_hash === 'string' && /^[0-9a-f]{64}$/.test(value.block_hash) && utc('detected_at_utc') && utc('resolved_at_utc') &&
    ['block_height', 'duration_seconds', 'reorg_depth', 'displaced_tx_count', 'double_spend_attempts_count'].every(integer);
}
