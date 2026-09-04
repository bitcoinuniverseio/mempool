import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { DlcApiService, DlcEvent } from './dlc.service';

@Component({
  selector: 'app-dlc-events',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">DLC Events and Announcements</h1>
          <span class="badge bg-secondary" *ngIf="events.length > 0">
            {{ events.length }} Events
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Verifiable oracle announcements, outcome descriptors, scheduled maturities, and attestation status.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/contracts/dlc">Overview</a>
          <a class="nav-link" routerLink="/contracts/dlc/oracles">Oracles</a>
          <a class="nav-link active" routerLink="/contracts/dlc/events">Events</a>
          <a class="nav-link" routerLink="/contracts/dlc/inspect">Contract Inspector</a>
          <a class="nav-link" routerLink="/contracts/dlc/simulate">Regtest Simulator</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading DLC events...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && events.length > 0" class="card p-4 bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Event ID</th>
                <th>Oracle ID</th>
                <th>Type</th>
                <th>Maturity</th>
                <th>Status</th>
                <th>Attestation</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let ev of events">
                <td class="font-monospace fw-bold">{{ ev.event_id }}</td>
                <td>
                  <a [routerLink]="['/contracts/dlc/oracle', ev.oracle_id]" class="text-decoration-none">
                    {{ ev.oracle_id }}
                  </a>
                </td>
                <td><span class="badge bg-secondary">{{ ev.event_descriptor.descriptor_type }}</span></td>
                <td class="small">{{ ev.maturity_formatted }}</td>
                <td>
                  <span class="badge" [ngClass]="ev.verification_status === 'verified' ? 'bg-success' : 'bg-warning text-dark'">
                    {{ ev.verification_status }}
                  </span>
                </td>
                <td>
                  <span *ngIf="ev.attestation" class="badge bg-primary">Signed</span>
                  <span *ngIf="!ev.attestation" class="badge bg-secondary">Pending</span>
                </td>
                <td>
                  <a [routerLink]="['/contracts/dlc/event', ev.event_id]" class="btn btn-sm btn-outline-primary">
                    Inspect
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class DlcEventsComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  events: DlcEvent[] = [];
  private sub?: Subscription;

  constructor(private dlcApi: DlcApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.sub = this.dlcApi.getEvents$().subscribe({
      next: (data) => {
        this.events = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load events';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
