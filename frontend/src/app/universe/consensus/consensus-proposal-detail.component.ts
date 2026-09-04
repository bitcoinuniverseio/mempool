import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ConsensusApiService, ConsensusProposal } from './consensus.service';

@Component({
  selector: 'app-consensus-proposal-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="d-flex align-items-center gap-2 mb-2">
          <a routerLink="/labs/consensus" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Proposals
          </a>
          <span class="text-muted small">Consensus Upgrade Lab</span>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Consensus Proposal Specification</h1>
          <span class="badge bg-primary" *ngIf="proposal && proposal.bip_number">
            BIP {{ proposal.bip_number }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading proposal specification details...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && proposal" class="content-body">
        <!-- Proposal Title Card -->
        <div class="card p-4 mb-4 bg-body-tertiary border">
          <h2 class="h4 text-primary mb-1">{{ proposal.title }}</h2>
          <div class="text-muted small mb-3">Authored by {{ proposal.author }} &bull; Created {{ proposal.created_at | date:'mediumDate' }}</div>
          <p class="mb-0">{{ proposal.summary }}</p>
        </div>

        <!-- Technical Attributes -->
        <div class="row g-4 mb-4">
          <div class="col-12 col-md-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h3 class="h5 mb-3">Protocol Primitives</h3>
              <ul class="list-group list-group-flush bg-transparent">
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Covenant Recursion Type</span>
                  <span class="badge bg-secondary">{{ proposal.covenant_type | titlecase }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Status Classification</span>
                  <span class="badge bg-warning text-dark">{{ proposal.status | uppercase }}</span>
                </li>
                <li class="list-group-item bg-transparent d-flex justify-content-between px-0">
                  <span class="text-muted">Activation Mechanism</span>
                  <span class="fw-semibold">{{ proposal.activation_mechanism }}</span>
                </li>
              </ul>
            </div>
          </div>

          <div class="col-12 col-md-6">
            <div class="card p-4 h-100 bg-body-tertiary border">
              <h3 class="h5 mb-3">Opcode Additions</h3>
              <div class="d-flex flex-wrap gap-2 mb-3">
                <code *ngFor="let op of proposal.opcodes" class="p-2 border rounded bg-body fw-bold">
                  {{ op }}
                </code>
              </div>
              <div class="text-muted small">
                These opcodes modify the Script execution engine to enable output template commitment or stack introspection.
              </div>
            </div>
          </div>
        </div>

        <div class="card p-3 bg-body-tertiary border d-flex flex-row justify-content-between align-items-center">
          <div>
            <div class="fw-semibold">Simulate this Proposal in a Vault</div>
            <div class="small text-muted">Test custody state transitions and emergency clawback mechanics.</div>
          </div>
          <a routerLink="/labs/vaults/simulate" class="btn btn-primary">
            Launch Covenant Simulator
          </a>
        </div>
      </div>
    </div>
  `,
})
export class ConsensusProposalDetailComponent implements OnInit, OnDestroy {
  proposal: ConsensusProposal | null = null;
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private api: ConsensusApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.route.paramMap.subscribe(params => {
        const id = params.get('proposalId');
        if (id) {
          this.fetchProposal(id);
        }
      })
    );
  }

  private fetchProposal(id: string): void {
    this.loading = true;
    this.sub.add(
      this.api.getProposalById$(id).subscribe({
        next: data => {
          this.proposal = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.error?.error || err?.message || 'Failed to load proposal';
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
