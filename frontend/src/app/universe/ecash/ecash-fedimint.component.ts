import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { EcashApiService, FedimintFederation } from './ecash.service';

@Component({
  selector: 'app-ecash-fedimint',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Fedimint Federation Directory</h1>
          <span class="badge bg-secondary" *ngIf="federations.length > 0">
            {{ federations.length }} Community Federations
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Guardian quorums, consensus threshold signatures, and module registries across distributed Fedimint federations.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/ecash">Overview</a>
          <a class="nav-link" routerLink="/ecash/cashu">Cashu Mints</a>
          <a class="nav-link active" routerLink="/ecash/fedimint">Fedimint Federations</a>
          <a class="nav-link" routerLink="/ecash/inspect">Offline Token Inspector</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Fedimint federations catalog...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && federations.length > 0" class="row g-4">
        <div *ngFor="let fed of federations" class="col-12 col-lg-6">
          <div class="card p-4 h-100 bg-body-tertiary border">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
              <div>
                <h2 class="h5 m-0">{{ fed.name }}</h2>
                <span class="small text-muted font-monospace">ID: {{ fed.federation_id }}</span>
              </div>
              <span class="badge bg-success">Epoch {{ fed.current_epoch | number }}</span>
            </div>

            <div class="mb-3">
              <div class="text-muted small mb-1">Guardian Quorum Threshold</div>
              <div class="h5 text-primary my-1">{{ fed.threshold }}-of-{{ fed.guardians_count }} Consensus</div>
              <div class="small text-muted">{{ fed.threshold }} signatures required to spend or sign blocks</div>
            </div>

            <div class="mb-3">
              <div class="text-muted small mb-1">Active Consensus Modules</div>
              <div class="d-flex flex-wrap gap-1">
                <span *ngFor="let mod of fed.modules" class="badge bg-secondary">
                  {{ mod }}
                </span>
              </div>
            </div>

            <div class="mt-auto pt-3 border-top d-flex justify-content-between align-items-center">
              <span class="small text-muted">Epoch Sync: {{ fed.last_epoch_at | date:'short' }}</span>
              <a [routerLink]="['/ecash/fedimint', fed.federation_id]" class="btn btn-sm btn-outline-primary">
                Inspect Federation
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link {
      color: inherit;
      padding: 0.4rem 0.8rem;
      border-radius: 0.375rem;
    }
    .nav-link.active {
      background-color: var(--bs-primary, #f7931a);
      color: #fff;
    }
  `],
})
export class EcashFedimintComponent implements OnInit, OnDestroy {
  federations: FedimintFederation[] = [];
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: EcashApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getFedimintFederations$().subscribe({
        next: data => {
          this.federations = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load Fedimint federations';
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
