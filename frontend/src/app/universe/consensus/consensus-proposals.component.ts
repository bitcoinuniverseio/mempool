import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { ConsensusApiService, ConsensusProposal } from './consensus.service';

@Component({
  selector: 'app-consensus-proposals',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Consensus Upgrade and Covenant Lab</h1>
          <span class="badge bg-secondary" *ngIf="proposals.length > 0">
            {{ proposals.length }} Pinned Proposals
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Versioned specifications, covenant primitives, opcode semantics, and custody state machine simulation for proposed Bitcoin upgrades.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link active" routerLink="/labs/consensus">Consensus Proposals</a>
          <a class="nav-link" routerLink="/labs/consensus/compare">Compare Matrix</a>
          <a class="nav-link" routerLink="/labs/vaults">Vaults Overview</a>
          <a class="nav-link" routerLink="/labs/vaults/designer">Vault Designer</a>
          <a class="nav-link" routerLink="/labs/vaults/simulate">Covenant Simulator</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading consensus proposals registry...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && proposals.length > 0" class="row g-4">
        <div *ngFor="let p of proposals" class="col-12 col-lg-6">
          <div class="card p-4 h-100 bg-body-tertiary border">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div>
                <span class="badge bg-primary me-1" *ngIf="p.bip_number">BIP {{ p.bip_number }}</span>
                <span class="badge bg-secondary">{{ p.covenant_type | titlecase }}</span>
                <h2 class="h5 mt-2 mb-1">{{ p.title }}</h2>
                <div class="small text-muted">Author: {{ p.author }}</div>
              </div>
              <span class="badge bg-warning text-dark">{{ p.status | uppercase }}</span>
            </div>

            <p class="small text-muted my-3">{{ p.summary }}</p>

            <div class="mb-3">
              <div class="text-muted small mb-1">Introduced Opcodes</div>
              <div class="d-flex flex-wrap gap-1">
                <code *ngFor="let op of p.opcodes" class="small bg-body p-1 rounded border">{{ op }}</code>
              </div>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Expressiveness</div>
                  <div class="fw-bold">{{ p.expressiveness_score }} / 100</div>
                </div>
              </div>
              <div class="col-6">
                <div class="p-2 border rounded bg-body">
                  <div class="text-muted small">Security Surface</div>
                  <div class="fw-bold">{{ p.security_surface_rating | titlecase }}</div>
                </div>
              </div>
            </div>

            <div class="mt-auto pt-3 border-top d-flex justify-content-between align-items-center">
              <a [href]="p.spec_url" target="_blank" rel="noopener" class="small text-decoration-none">
                Official Spec &nearr;
              </a>
              <a [routerLink]="['/labs/consensus', p.proposal_id]" class="btn btn-sm btn-outline-primary">
                Inspect Specification
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
export class ConsensusProposalsComponent implements OnInit, OnDestroy {
  proposals: ConsensusProposal[] = [];
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: ConsensusApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getProposals$().subscribe({
        next: data => {
          this.proposals = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load proposals';
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
