import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { DlcApiService, DlcOverview, DlcOverviewAnnouncement } from './dlc.service';

@Component({
  selector: 'app-dlc-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Discreet Log Contract and Oracle Verification Center</h1>
          <span class="badge bg-secondary" *ngIf="overview">
            {{ overview.total_oracles ?? 'Not reported' }} Registered Oracles
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Authoritative verification of Discreet Log Contract announcements, attestations, CET structures, and oracle equivocation evidence.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/contracts/dlc">Overview</a>
          <a class="nav-link" routerLink="/contracts/dlc/oracles">Oracles</a>
          <a class="nav-link" routerLink="/contracts/dlc/events">Events</a>
          <a class="nav-link" routerLink="/contracts/dlc/inspect">Contract Inspector</a>
          <a class="nav-link" routerLink="/contracts/dlc/simulate">Regtest Simulator</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading DLC verification overview...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && overview" class="row g-4">
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Registered Oracles</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_oracles ?? 'Not reported' }}</div>
            <div class="small text-muted mt-1">{{ overview.healthy_oracles ?? 'Not reported' }} currently healthy</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Observed Events</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.active_events ?? 'Not reported' }}</div>
            <div class="small text-muted mt-1">Enumerated and numeric</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Observed Attestations</div>
            <div class="fs-4 fw-bold mt-1">{{ overview.total_attestations ?? 'Not reported' }}</div>
            <div class="small text-muted mt-1">BIP340 Schnorr signatures</div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Equivocation Conflicts</div>
            <div class="fs-4 fw-bold mt-1" [ngClass]="overview.verified_conflicts > 0 ? 'text-danger' : 'text-muted'">
              {{ overview.verified_conflicts ?? 'Not reported' }}
            </div>
            <div class="small text-muted mt-1">Cryptographic proof records</div>
          </div>
        </div>

        <div class="col-12 col-lg-8">
          <div class="card p-4 bg-body-tertiary border h-100">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h2 class="h5 m-0">Recent Oracle Announcements</h2>
              <a routerLink="/contracts/dlc/events" class="small text-decoration-none">View All &rarr;</a>
            </div>
            <div class="table-responsive" tabindex="0" role="region" aria-label="Recent Oracle Announcements, scroll horizontally" i18n-aria-label>
              <table class="table table-sm table-hover align-middle">
                <thead>
                  <tr>
                    <th>Event ID</th>
                    <th>Oracle</th>
                    <th>Descriptor</th>
                    <th>Maturity</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let ev of overview.recent_events">
                    <td>
                      <a [routerLink]="['/contracts/dlc/event', ev.event_id]" class="font-monospace text-decoration-none">
                        {{ ev.event_id }}
                      </a>
                    </td>
                    <td>{{ ev.oracle_id }}</td>
                    <td><span class="badge bg-secondary">{{ descriptorType(ev) }}</span></td>
                    <td class="small">{{ ev.maturity_formatted || 'Not reported' }}</td>
                    <td>
                      <span class="badge" [ngClass]="ev.verified === true ? 'bg-success' : 'bg-secondary'">
                        {{ ev.verified === true ? 'Verified' : ev.verified === false ? 'Not verified' : 'Not reported' }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Protocol Specifications</h2>
            <p class="small text-muted">
              Supported revisions not reported by the overview API.
            </p>
            <div class="alert alert-info py-2 px-3 small m-0">
              Contract terms are private by design. On-chain relationship detection is only possible when a contract package is provided.
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class DlcOverviewComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  overview: DlcOverview | null = null;
  private sub?: Subscription;

  constructor(private dlcApi: DlcApiService, private cdr: ChangeDetectorRef) {}

  descriptorType(event: DlcOverviewAnnouncement): string {
    const type = event?.event_descriptor?.type;
    return type === 'enumerated' || type === 'numeric' ? type : 'Not reported';
  }

  ngOnInit(): void {
    this.sub = this.dlcApi.getOverview$().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load DLC overview';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
