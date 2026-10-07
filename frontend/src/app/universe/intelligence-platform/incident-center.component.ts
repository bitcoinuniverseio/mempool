import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, timeout } from 'rxjs';
import { IncidentRecord, IncidentResponse, validIncidentResponse } from './incident-observations';
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
          Retained chain reorganizations, stale tips and node-tip divergence reported by registered node observations. Node-tip divergence is not a consensus-validation verdict.
        </p>
        <p class="small text-muted">Consensus and invalid-block validation unavailable. Displaced transactions and double-spend attempts unmeasured. These records do not establish global consensus or complete monitoring.</p>
        <button class="btn btn-outline-secondary" (click)="retry()" [disabled]="loading">Retry incident observations</button>
      </header>

      <div *ngIf="loadError" role="alert" class="alert alert-danger mb-4">
        {{ loadError }}
      </div>

      <div *ngIf="!loading && incidents.length === 0 && !loadError" class="p-4 rounded bg-dark-subtle text-muted text-center mb-4">
        No incident records returned by the selected source. This does not establish consensus agreement or complete monitoring coverage.
      </div>

      <section *ngIf="response as r" class="card mb-4" aria-label="Incident source and retained coverage">
        <div class="card-body">
          <h2 class="h5">Reported source profile and retained coverage</h2>
          <p>Network: {{ r.network }}. Profile SHA256: <code class="text-break">{{ r.profile_sha256 }}</code></p>
          <p class="small">The digest binds the returned registration; it does not independently attest the operator or establish consensus agreement.</p>
          <p>Started {{ r.coverage.started_at_utc }}; last observation {{ r.coverage.last_observed_at_utc || 'Not observed' }}; {{ r.coverage.observation_count }} retained observation commits.
            Limits: {{ r.coverage.retained_header_limit }} headers per node / {{ r.coverage.retained_incident_limit }} incident records. Monitoring incomplete.</p>
          <div *ngFor="let source of r.profile.sources" class="border-top pt-2 mb-2">
            <strong>{{ source.source_id }}</strong> / independence group {{ source.independence_id }} / {{ source.implementation }}
            <div>Source revision: {{ source.source_revision || 'Not reported' }}</div>
            <div class="text-break">Binary SHA256: {{ source.binary_sha256 }}; configuration SHA256: {{ source.configuration_sha256 }}</div>
            <div class="text-break">Genesis: {{ source.genesis_hash }}; block one: {{ source.block_one_hash }}</div>
            <div class="text-break">Signet challenge: {{ source.signet_challenge || 'Not applicable' }}</div>
          </div>
          <div *ngFor="let source of r.sources" class="border-top pt-2 mb-2">
            {{ source.source_id }}: {{ source.status }}; observed {{ source.observed_at_utc || 'Not observed' }}.
            <div *ngIf="source.checkpoint as checkpoint" class="text-break">Checkpoint {{ checkpoint.height }}: {{ checkpoint.hash }}; parent {{ checkpoint.parent }}; header timestamp {{ checkpoint.timestamp }} seconds.</div>
          </div>
          <h3 class="h6">Retained monitoring gaps</h3>
          <p *ngIf="!r.coverage.gaps.length">No retained gap records; this does not establish complete coverage.</p>
          <div *ngFor="let gap of r.coverage.gaps">{{ gap.at_utc }}: {{ gap.reason }}</div>
        </div>
      </section>
      <section class="incidents-list" *ngIf="incidents.length > 0">
        <div *ngFor="let incident of incidents" class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <span class="badge" [ngClass]="incident.status === 'resolved' ? 'badge-success' : 'badge-warning'">
                {{ incident.status | uppercase }}
              </span>
              <span class="badge badge-secondary ms-2 text-uppercase">{{ incident.incident_type }}</span>
              <h4 class="mt-2 mb-0">{{ incident.title }}</h4>
              <p *ngIf="incident.incident_type === 'reorg' && incident.evidence.common_ancestor?.hash === incident.block_hash">
                Retained headers show a tip rollback to the ancestor; no competing replacement branch is shown.
              </p>
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
                  <div class="fw-bold text-warning">{{ incident.reorg_depth === null ? 'Not measured' : incident.reorg_depth + ' blocks' }}</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-2 rounded bg-dark-subtle h-100">
                  <div class="small text-muted">Displaced Transactions</div>
                  <div class="fw-bold">Unmeasured</div>
                </div>
              </div>
              <div class="col-md-3 col-6">
                <div class="p-2 rounded bg-dark-subtle h-100">
                  <div class="small text-muted">Resolution Time</div>
                  <div class="fw-bold text-success">{{ incident.duration_seconds === null ? 'Unresolved / not measured' : incident.duration_seconds + ' seconds' }}</div>
                </div>
              </div>
            </div>

            <p class="text-break">Block hash: {{ incident.block_hash }}. Sources: {{ incident.source_ids.join(', ') }}.</p>
            <p>Resolved at: {{ incident.resolved_at_utc || 'Unresolved' }}. Double-spend attempts: Unmeasured.</p>
            <h5 class="h6">Retained observation timeline</h5>
            <div *ngFor="let event of incident.timeline">{{ event.observed_at_utc }}: {{ event.stage }} ({{ event.source_ids.join(', ') }})</div>
            <details class="my-3">
              <summary>Retained header evidence</summary>
              <div *ngIf="incident.evidence.common_ancestor as ancestor" class="text-break">Common ancestor {{ ancestor.height }}: {{ ancestor.hash }}</div>
              <p *ngIf="!incident.evidence.common_ancestor">Common ancestor not reported.</p>
              <div *ngFor="let header of incident.evidence.before" class="text-break">Before {{ header.height }}: {{ header.hash }} / parent {{ header.parent }} / {{ header.timestamp }} seconds</div>
              <div *ngFor="let header of incident.evidence.after" class="text-break">After {{ header.height }}: {{ header.hash }} / parent {{ header.parent }} / {{ header.timestamp }} seconds</div>
            </details>
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
  incidents: IncidentRecord[] = [];
  response: IncidentResponse | null = null;
  loading = false;
  loadError: string | null = null;
  observed = false;

  private sub?: Subscription;
  private networkSub?: Subscription;
  private revision = 0;
  private destroyed = false;
  private selectedNetwork: string;

  get activeIncidentsCount(): number {
    return this.incidents.filter((i) => i.status !== 'resolved').length;
  }

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef,
    private stateService: StateService = null
  ) {}

  ngOnInit(): void {
    this.selectedNetwork = this.network;
    this.networkSub = this.stateService?.networkChanged$?.subscribe(() => {
      if (this.selectedNetwork === this.network) return;
      this.selectedNetwork = this.network;
      this.load();
    });
    this.load();
  }

  private get network(): string { return this.stateService?.network || this.stateService?.env?.ROOT_NETWORK || 'mainnet'; }

  private load(): void {
    if (this.destroyed) return;
    const revision = ++this.revision, network = this.network;
    this.sub?.unsubscribe();
    this.incidents = [];
    this.response = null;
    this.loadError = null;
    this.observed = false;
    this.loading = true;
    this.sub = this.api.getIncidents$().pipe(timeout(15000)).subscribe({
      next: (res) => {
        if (this.destroyed || revision !== this.revision || network !== this.network) return;
        if (!validIncidentResponse(res, network)) {
          this.response = null;
          this.observed = false;
          this.loadError = 'The selected incident source returned an invalid or incomplete response.';
          this.incidents = [];
        } else {
          this.response = res;
          this.incidents = res.incidents;
          this.observed = true;
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (this.destroyed || revision !== this.revision || network !== this.network) return;
        this.incidents = [];
        this.response = null;
        this.observed = false;
        this.loadError = err?.error?.error || loadFailureMessage(classifyLoadFailure(err));
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  retry(): void { if (!this.loading) this.load(); }

  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.revision;
    this.sub?.unsubscribe();
    this.networkSub?.unsubscribe();
  }
}
