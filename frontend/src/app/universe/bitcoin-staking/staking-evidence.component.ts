import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { BitcoinStakingApiService, EotsSlashingEvidence } from './bitcoin-staking.service';

@Component({
  selector: 'app-staking-evidence',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">EOTS Equivocation & Slashing Evidence</h1>
          <span class="badge bg-danger" *ngIf="evidenceList.length > 0">
            {{ evidenceList.length }} Proven Equivocations
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Extractable One-Time Signature (EOTS) dual-signature evidence verification. Proves finality provider equivocation and derives the secret scalar hash.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/protocols/bitcoin-staking">Overview</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/delegations">Delegations</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/finality-providers">Finality Providers</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/parameters">Parameters</a>
          <a class="nav-link active" routerLink="/protocols/bitcoin-staking/evidence">Slashing Evidence</a>
          <a class="nav-link" routerLink="/protocols/bitcoin-staking/reconciliation">PoS Reconciliation</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Verify Slashing Evidence Package</h2>
            <p class="small text-muted mb-3">
              Submit dual signatures over distinct messages using an identical nonce point to mathematically verify EOTS equivocation.
            </p>

            <div class="mb-2">
              <label class="form-label small text-muted">EOTS Public Key</label>
              <input type="text" class="form-control font-monospace small" [(ngModel)]="eotsPk" />
            </div>

            <div class="mb-2">
              <label class="form-label small text-muted">Committed Nonce Point (R)</label>
              <input type="text" class="form-control font-monospace small" [(ngModel)]="noncePoint" />
            </div>

            <div class="row g-2 mb-2">
              <div class="col-6">
                <label class="form-label small text-muted">Signed Message A</label>
                <input type="text" class="form-control font-monospace small" [(ngModel)]="msgA" />
              </div>
              <div class="col-6">
                <label class="form-label small text-muted">Signed Message B</label>
                <input type="text" class="form-control font-monospace small" [(ngModel)]="msgB" />
              </div>
            </div>

            <div class="mb-3">
              <label class="form-label small text-muted">Signature A & Signature B</label>
              <input type="text" class="form-control font-monospace small mb-1" [(ngModel)]="sigA" placeholder="Sig A" />
              <input type="text" class="form-control font-monospace small" [(ngModel)]="sigB" placeholder="Sig B" />
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-danger" (click)="verifyEvidence()" [disabled]="verifying">
                <span *ngIf="verifying" class="spinner-border spinner-border-sm me-1"></span>
                Verify Equivocation
              </button>
              <button class="btn btn-outline-secondary" (click)="loadSample()">
                Load Sample Evidence
              </button>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Verification Proof Assessment</h2>

            <div *ngIf="!report && !verifying" class="text-center py-5 text-muted">
              Submit dual EOTS signatures to verify mathematical equivocation.
            </div>

            <div *ngIf="verifying" class="text-center py-5 text-muted">
              <div class="spinner-border text-danger mb-2"></div>
              <div>Extracting secret scalar and verifying Schnorr verification equations...</div>
            </div>

            <div *ngIf="report">
              <div class="alert" [ngClass]="report.verified ? 'alert-danger' : 'alert-warning'">
                <div class="fw-bold">{{ report.verified ? 'EQUIVOCATION CRYPTOGRAPHICALLY PROVEN' : 'INVALID EVIDENCE' }}</div>
                <div class="small mt-1">{{ report.reason }}</div>
              </div>

              <div class="p-3 border rounded bg-body mb-3">
                <div class="text-muted small">Status</div>
                <div class="badge" [ngClass]="report.status === 'equivocation_proven' ? 'bg-danger' : 'bg-secondary'">
                  {{ report.status | uppercase }}
                </div>
              </div>

              <div class="p-3 border rounded bg-body mb-3" *ngIf="report.recovered_secret_hash">
                <div class="text-muted small">Recovered Private Key Scalar Hash (SHA-256)</div>
                <div class="font-monospace small text-break mt-1">{{ report.recovered_secret_hash }}</div>
                <div class="small text-muted mt-1">Proof derived without exposing raw secret in cleartext.</div>
              </div>

              <div class="alert alert-info py-2 px-3 small m-0">
                With this proof, any network observer can broadcast a valid Babylon slashing transaction burning the finality provider's locked stake.
              </div>
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
export class StakingEvidenceComponent implements OnInit, OnDestroy {
  evidenceList: EotsSlashingEvidence[] = [];
  eotsPk = '02e4d94d3b64c679b3ee38734fe0d15e9858df34ab941b38f15d2a937964177d61';
  noncePoint = '028888888888888888888888888888888888888888888888888888888888888888';
  msgA = 'vote_block_alpha_height_858102';
  msgB = 'vote_block_beta_height_858102';
  sigA = '3045022100a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2022001';
  sigB = '3045022100a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2022002';
  verifying = false;
  report: any = null;
  private sub?: Subscription;

  constructor(
    private stakingApi: BitcoinStakingApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.stakingApi.getEvidence$().subscribe({
      next: (data) => {
        this.evidenceList = data;
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  loadSample(): void {
    this.eotsPk = '02e4d94d3b64c679b3ee38734fe0d15e9858df34ab941b38f15d2a937964177d61';
    this.noncePoint = '028888888888888888888888888888888888888888888888888888888888888888';
    this.msgA = 'vote_block_alpha_height_858102';
    this.msgB = 'vote_block_beta_height_858102';
    this.cdr.markForCheck();
  }

  verifyEvidence(): void {
    this.verifying = true;
    this.report = null;

    this.stakingApi
      .verifyEvidence$({
        eots_pk: this.eotsPk,
        nonce_point: this.noncePoint,
        message_a: this.msgA,
        message_b: this.msgB,
        signature_a: this.sigA,
        signature_b: this.sigB,
      })
      .subscribe({
        next: (res) => {
          this.report = res;
          this.verifying = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.verifying = false;
          this.report = {
            verified: false,
            status: 'invalid_evidence',
            reason: err.message || 'Evidence verification error',
          };
          this.cdr.markForCheck();
        },
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
