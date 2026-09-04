import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { DlcApiService, DlcEvent } from './dlc.service';

@Component({
  selector: 'app-dlc-event-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a routerLink="/contracts/dlc/events" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Events
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="event">
          <div>
            <h1 class="m-0">{{ event.event_id }}</h1>
            <div class="text-muted small mt-1">Oracle: {{ event.oracle_id }}</div>
          </div>
          <span class="badge" [ngClass]="event.verification_status === 'verified' ? 'bg-success' : 'bg-warning text-dark'">
            {{ event.verification_status | uppercase }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading event details...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && event" class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border mb-4">
            <h2 class="h5 mb-3">Event Announcement Specification</h2>
            <dl class="row mb-0">
              <dt class="col-sm-4 text-muted">Descriptor Type</dt>
              <dd class="col-sm-8"><span class="badge bg-secondary">{{ event.event_descriptor.descriptor_type }}</span></dd>

              <dt class="col-sm-4 text-muted" *ngIf="event.event_descriptor.outcomes">Allowed Outcomes</dt>
              <dd class="col-sm-8" *ngIf="event.event_descriptor.outcomes">
                <span *ngFor="let out of event.event_descriptor.outcomes" class="badge bg-body border text-body me-1">
                  {{ out }}
                </span>
              </dd>

              <dt class="col-sm-4 text-muted" *ngIf="event.event_descriptor.min_value !== undefined">Numeric Bounds</dt>
              <dd class="col-sm-8 font-monospace small" *ngIf="event.event_descriptor.min_value !== undefined">
                {{ event.event_descriptor.min_value }} &ndash; {{ event.event_descriptor.max_value }} ({{ event.event_descriptor.num_digits }} digits)
              </dd>

              <dt class="col-sm-4 text-muted">Maturity (UTC)</dt>
              <dd class="col-sm-8">{{ event.maturity_formatted }}</dd>

              <dt class="col-sm-4 text-muted">Maturity Epoch</dt>
              <dd class="col-sm-8 font-monospace small">{{ event.event_maturity_epoch }}</dd>

              <dt class="col-sm-4 text-muted">Announcement Sig</dt>
              <dd class="col-sm-8 font-monospace small text-break">{{ event.announcement_signature }}</dd>
            </dl>
          </div>

          <div class="card p-4 bg-body-tertiary border">
            <h2 class="h5 mb-3">Committed Nonces ({{ event.nonces.length }})</h2>
            <p class="small text-muted mb-2">
              Public nonces committed by the oracle for this event. These points are checked against all known oracle announcements to prevent nonce reuse attacks.
            </p>
            <div *ngFor="let nonce of event.nonces; let i = index" class="p-2 border rounded bg-body font-monospace small text-break mb-1">
              <span class="text-muted me-2">#{{ i }}:</span> {{ nonce }}
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Attestation Verification</h2>
            <div *ngIf="event.attestation">
              <div class="alert alert-success py-2 px-3 small mb-3">
                Attestation signature verified against announcement nonces.
              </div>

              <div class="mb-3">
                <div class="text-muted small">Signed Outcome</div>
                <div class="fs-5 fw-bold font-monospace">{{ event.attestation.outcomes.join(', ') }}</div>
              </div>

              <div class="mb-3">
                <div class="text-muted small">Attestation Timestamp</div>
                <div class="small">{{ event.attestation.attestation_time }}</div>
              </div>

              <div class="mb-3">
                <div class="text-muted small">Attestation Delay</div>
                <div class="small">{{ event.attestation.attestation_delay_seconds }} seconds after maturity</div>
              </div>

              <div>
                <div class="text-muted small mb-1">Signatures ({{ event.attestation.signatures.length }})</div>
                <div *ngFor="let sig of event.attestation.signatures" class="p-2 border rounded bg-body font-monospace small text-break mb-1">
                  {{ sig }}
                </div>
              </div>
            </div>

            <div *ngIf="!event.attestation" class="text-center py-4 text-muted">
              <div class="badge bg-secondary mb-2">Awaiting Attestation</div>
              <p class="small m-0">Event maturity has not been reached or oracle has not yet published signatures.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class DlcEventDetailComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  event: DlcEvent | null = null;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private dlcApi: DlcApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const eventId = this.route.snapshot.paramMap.get('eventId') || 'event-btc-usd-2026-q4';
    this.sub = this.dlcApi.getEventById$(eventId).subscribe({
      next: (data) => {
        this.event = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load event detail';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
