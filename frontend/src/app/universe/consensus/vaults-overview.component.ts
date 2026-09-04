import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { ConsensusApiService, VaultDesignTemplate } from './consensus.service';

@Component({
  selector: 'app-vaults-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Bitcoin Vault Architecture Lab</h1>
          <span class="badge bg-primary">Noncustodial Institutional Custody</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Explore on-chain vault state machines enforcing delayed withdrawals, emergency clawbacks, and anti-theft covenants.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/labs/consensus">Consensus Proposals</a>
          <a class="nav-link" routerLink="/labs/consensus/compare">Compare Matrix</a>
          <a class="nav-link active" routerLink="/labs/vaults">Vaults Overview</a>
          <a class="nav-link" routerLink="/labs/vaults/designer">Vault Designer</a>
          <a class="nav-link" routerLink="/labs/vaults/simulate">Covenant Simulator</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading vault architectural templates...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && templates.length > 0" class="row g-4 mb-4">
        <div *ngFor="let t of templates" class="col-12 col-lg-6">
          <div class="card p-4 h-100 bg-body-tertiary border">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
              <div>
                <h2 class="h5 m-0">{{ t.name }}</h2>
                <span class="badge bg-secondary">Target: {{ t.proposal_target | uppercase }}</span>
              </div>
              <span class="badge bg-success">Verified Template</span>
            </div>

            <p class="small text-muted mb-3">{{ t.description }}</p>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Challenge Window</div>
                  <div class="fw-bold">{{ t.recovery_delay_blocks }} blocks (~{{ (t.recovery_delay_blocks * 10 / 60).toFixed(0) }}h)</div>
                </div>
              </div>
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Hot Authorization Keys</div>
                  <div class="fw-bold">{{ t.hot_key_threshold }} Key Required</div>
                </div>
              </div>
            </div>

            <div class="mt-auto pt-3 border-top d-flex justify-content-between align-items-center">
              <span class="small text-success" *ngIf="t.auto_cancel_available">&check; Emergency Clawback Active</span>
              <a routerLink="/labs/vaults/designer" class="btn btn-sm btn-outline-primary">
                Open in Designer
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Action CTA -->
      <div class="card p-4 bg-body-tertiary border d-flex flex-row justify-content-between align-items-center">
        <div>
          <h2 class="h5 mb-1">Create a Custom Vault State Machine</h2>
          <div class="small text-muted">Configure hot signing keys, emergency cold recovery paths, and timelocks.</div>
        </div>
        <a routerLink="/labs/vaults/designer" class="btn btn-primary">
          Launch Vault Designer
        </a>
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
export class VaultsOverviewComponent implements OnInit, OnDestroy {
  templates: VaultDesignTemplate[] = [];
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: ConsensusApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getVaultTemplates$().subscribe({
        next: data => {
          this.templates = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load vault templates';
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
