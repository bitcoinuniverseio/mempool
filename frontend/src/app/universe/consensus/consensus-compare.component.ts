import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { ConsensusApiService, ConsensusProposal } from './consensus.service';

@Component({
  selector: 'app-consensus-compare',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Covenant Proposal Comparison Matrix</h1>
          <span class="badge bg-primary">Comparative Technical Audit</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Side-by-side evaluation of Bitcoin covenant proposals across expressiveness, computational weight, and consensus risk.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/labs/consensus">Consensus Proposals</a>
          <a class="nav-link active" routerLink="/labs/consensus/compare">Compare Matrix</a>
          <a class="nav-link" routerLink="/labs/vaults">Vaults Overview</a>
          <a class="nav-link" routerLink="/labs/vaults/designer">Vault Designer</a>
          <a class="nav-link" routerLink="/labs/vaults/simulate">Covenant Simulator</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading comparative analysis...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && proposals.length > 0" class="card bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Proposal</th>
                <th>Covenant Classification</th>
                <th>Expressiveness</th>
                <th>Security Surface</th>
                <th>Opcodes</th>
                <th>Activation Path</th>
                <th class="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let p of proposals">
                <td>
                  <div class="fw-bold">{{ p.title }}</div>
                  <span class="badge bg-secondary" *ngIf="p.bip_number">BIP {{ p.bip_number }}</span>
                </td>
                <td><span class="badge bg-info">{{ p.covenant_type | titlecase }}</span></td>
                <td>
                  <div class="d-flex align-items-center gap-2">
                    <div class="progress flex-grow-1" style="height: 6px; min-width: 60px;">
                      <div class="progress-bar bg-primary" [style.width.%]="p.expressiveness_score"></div>
                    </div>
                    <span class="small">{{ p.expressiveness_score }}/100</span>
                  </div>
                </td>
                <td>
                  <span class="badge" [ngClass]="{
                    'bg-success': p.security_surface_rating === 'minimal',
                    'bg-warning': p.security_surface_rating === 'moderate',
                    'bg-danger': p.security_surface_rating === 'complex'
                  }">
                    {{ p.security_surface_rating | titlecase }}
                  </span>
                </td>
                <td>
                  <code *ngFor="let op of p.opcodes" class="small me-1">{{ op }}</code>
                </td>
                <td class="small text-muted">{{ p.activation_mechanism }}</td>
                <td class="text-end">
                  <a [routerLink]="['/labs/consensus', p.proposal_id]" class="btn btn-sm btn-outline-primary">
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
export class ConsensusCompareComponent implements OnInit, OnDestroy {
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
          this.error = err?.message || 'Failed to load proposals for comparison';
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
