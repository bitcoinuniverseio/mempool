import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { BootstrapApiService, NodeChainstateObservation } from './bootstrap.service';

@Component({
  selector: 'app-bootstrap-chainstates',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Dual-Chainstate Synchronization Observatory</h1>
          <span class="badge bg-secondary" *ngIf="nodes.length > 0">
            {{ nodes.length }} Connected Nodes
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Live monitoring of Bitcoin Core nodes running dual chainstates: snapshot chainstate (tip sync) vs background chainstate (historical IBD).
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/node/bootstrap">Overview</a>
          <a class="nav-link" routerLink="/node/bootstrap/snapshots">Snapshots</a>
          <a class="nav-link" routerLink="/node/bootstrap/verify">Integrity Verifier</a>
          <a class="nav-link" routerLink="/node/bootstrap/planner">Bootstrap Planner</a>
          <a class="nav-link active" routerLink="/node/bootstrap/chainstates">Dual Chainstates</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading node chainstate telemetry...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && nodes.length > 0" class="row g-4">
        <div *ngFor="let n of nodes" class="col-12 col-lg-6">
          <div class="card p-4 h-100 bg-body-tertiary border">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div>
                <h2 class="h5 mt-1 mb-1 font-monospace">{{ n.node_id }}</h2>
                <div class="small text-muted font-monospace">{{ n.client_version }}</div>
              </div>
              <span class="badge" [ngClass]="n.dual_chainstate_active ? 'bg-info text-dark' : 'bg-success'">
                {{ n.dual_chainstate_active ? 'DUAL CHAINSTATE ACTIVE' : 'FULLY SYNCHRONIZED' }}
              </span>
            </div>

            <div class="my-3">
              <div class="d-flex justify-content-between small text-muted mb-1">
                <span>Background Validation Progress</span>
                <span class="fw-bold font-monospace">{{ n.sync_percent.toFixed(1) }}%</span>
              </div>
              <div class="progress" style="height: 10px;">
                <div class="progress-bar progress-bar-striped progress-bar-animated" [style.width.%]="n.sync_percent"></div>
              </div>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Background IBD Height</div>
                  <div class="fw-bold font-monospace">#{{ n.background_ibd_height }}</div>
                </div>
              </div>
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Snapshot Chainstate Tip</div>
                  <div class="fw-bold font-monospace">#{{ n.tip_height }}</div>
                </div>
              </div>
            </div>

            <div class="p-2 border rounded bg-body mb-3">
              <div class="text-muted small">Estimated Background Validation Completion</div>
              <div class="small font-monospace fw-bold">
                {{ (n.estimated_time_to_validation_completion_sec / 3600).toFixed(1) }} hours remaining
              </div>
            </div>

            <div class="alert alert-info py-2 px-3 small m-0 mt-auto">
              Once background IBD reaches the snapshot block height, Bitcoin Core confirms the state hashes match and gracefully decommissions the background chainstate.
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
export class BootstrapChainstatesComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  nodes: NodeChainstateObservation[] = [];
  private sub?: Subscription;

  constructor(
    private bootstrapApi: BootstrapApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.bootstrapApi.getNodeChainstates$().subscribe({
      next: (data) => {
        this.nodes = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load node chainstates';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
