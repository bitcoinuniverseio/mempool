import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { EcashApiService, FedimintFederation } from './ecash.service';

@Component({
  selector: 'app-ecash-fedimint-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="d-flex align-items-center gap-2 mb-2">
          <a routerLink="/ecash/fedimint" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Fedimint Federations
          </a>
          <span class="text-muted small">Fedimint Observatory</span>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Fedimint Federation Telemetry</h1>
          <span class="badge bg-success" *ngIf="federation">
            Epoch {{ federation.current_epoch | number }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading federation consensus state...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && federation" class="content-body">
        <!-- Federation Overview Card -->
        <div class="card p-4 mb-4 bg-body-tertiary border">
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <div class="text-muted small">Federation Entity</div>
              <div class="h4 text-primary">{{ federation.name }}</div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-muted small">Consensus Quorum</div>
              <div class="h4">{{ federation.threshold }} of {{ federation.guardians_count }} Guardians Required</div>
            </div>
          </div>
        </div>

        <!-- Consensus Modules -->
        <div class="row g-4 mb-4">
          <div class="col-12 col-md-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h2 class="h5 mb-3">Consensus Modules</h2>
              <ul class="list-group list-group-flush bg-transparent">
                <li *ngFor="let mod of federation.modules" class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="fw-semibold">{{ mod | uppercase }}</span>
                  <span class="badge bg-success">Active Consensus Module</span>
                </li>
              </ul>
            </div>
          </div>

          <div class="col-12 col-md-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h2 class="h5 mb-3">Epoch State</h2>
              <ul class="list-group list-group-flush bg-transparent">
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Current Federation Epoch</span>
                  <span class="fw-semibold">{{ federation.current_epoch | number }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Last Epoch Timestamp</span>
                  <span class="small text-muted">{{ federation.last_epoch_at | date:'medium' }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Federation Identifier</span>
                  <code class="small">{{ federation.federation_id }}</code>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Sample Invite Code -->
        <div *ngIf="federation.invite_code_sample" class="card p-4 bg-body-tertiary border">
          <h2 class="h5 mb-2">Sample Federation Invite Code</h2>
          <code class="p-3 bg-body rounded text-break font-monospace small mb-2 d-block">
            {{ federation.invite_code_sample }}
          </code>
          <div class="d-flex justify-content-between align-items-center">
            <span class="small text-muted">Inspect structure offline without contacting federation peers.</span>
            <a routerLink="/ecash/inspect" class="btn btn-sm btn-outline-primary">
              Inspect in Offline Inspector
            </a>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class EcashFedimintDetailComponent implements OnInit, OnDestroy {
  federation: FedimintFederation | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private api: EcashApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.route.paramMap.subscribe(params => {
        const fedId = params.get('federationId');
        if (fedId) {
          this.fetchFederation(fedId);
        }
      })
    );
  }

  private fetchFederation(fedId: string): void {
    this.loading = true;
    this.sub.add(
      this.api.getFedimintFederationById$(fedId).subscribe({
        next: data => {
          this.federation = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.error?.error || err?.message || 'Failed to load federation details';
          this.loading = false;
          this.cd.markForCheck();
        },
      })
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
