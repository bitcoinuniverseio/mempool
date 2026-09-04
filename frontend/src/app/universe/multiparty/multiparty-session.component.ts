import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';

@Component({
  selector: 'app-multiparty-session',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a routerLink="/tools/multiparty/musig2" class="btn btn-sm btn-outline-secondary">
            &larr; Back to MuSig2 Coordinator
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h1 class="m-0 font-monospace">{{ sessionId }}</h1>
            <div class="text-muted small mt-1">MuSig2 Multi-Round Signature State Machine</div>
          </div>
          <span class="badge bg-primary">ROUND 2: PARTIAL SIGS</span>
        </div>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border mb-4">
            <h2 class="h5 mb-3">Session Progress</h2>
            <div class="d-flex flex-column gap-3">
              <div class="p-3 border rounded bg-body">
                <div class="d-flex justify-content-between">
                  <span class="fw-bold">Round 1: Nonce Exchange</span>
                  <span class="badge bg-success">COMPLETE</span>
                </div>
                <p class="small text-muted mb-0 mt-1">All cosigners published two 33-byte public nonces (R1, R2).</p>
              </div>

              <div class="p-3 border rounded bg-body">
                <div class="d-flex justify-content-between">
                  <span class="fw-bold">Round 2: Partial Signature Exchange</span>
                  <span class="badge bg-warning text-dark">IN PROGRESS (1/2)</span>
                </div>
                <p class="small text-muted mb-0 mt-1">Awaiting partial signature from secondary participant.</p>
              </div>

              <div class="p-3 border rounded bg-body">
                <div class="d-flex justify-content-between">
                  <span class="fw-bold">Final Aggregation: BIP340 Schnorr</span>
                  <span class="badge bg-secondary">PENDING</span>
                </div>
                <p class="small text-muted mb-0 mt-1">Single 64-byte signature will be assembled on receipt of all partial signatures.</p>
              </div>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Session Parameters</h2>
            <dl class="row mb-0">
              <dt class="col-sm-5 text-muted">Message Hash</dt>
              <dd class="col-sm-7 font-monospace small text-truncate">e3b0c44298fc1c14...</dd>

              <dt class="col-sm-5 text-muted">Aggregated Key</dt>
              <dd class="col-sm-7 font-monospace small text-truncate">a89c7d8e9f0a1b2c...</dd>

              <dt class="col-sm-5 text-muted">Signers</dt>
              <dd class="col-sm-7 font-monospace small">2 participants</dd>
            </dl>

            <div class="alert alert-info py-2 px-3 small m-0 mt-auto">
              This session was created in-memory and state transitions are validated locally.
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class MultipartySessionComponent implements OnInit {
  sessionId = 'session-musig2-cold-01';

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.sessionId = this.route.snapshot.paramMap.get('sessionId') || 'session-musig2-cold-01';
  }
}
