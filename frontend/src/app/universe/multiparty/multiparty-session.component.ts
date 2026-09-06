import { Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';
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
        <h1 class="m-0">MuSig2 Signing Session</h1>
        <p class="text-muted font-monospace mt-2" *ngIf="sessionId">Requested session: {{ sessionId }}</p>
      </header>

      <div class="alert alert-warning" role="alert">
        Session evidence is unavailable. A session reader with durable records and verified signing-round transitions is not connected.
        This page cannot establish whether the requested session exists or has completed any signing round.
      </div>
      <div class="card p-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Session Progress and Parameters</h2>
        <dl class="row mb-0">
          <dt class="col-sm-5 text-muted">Nonce exchange</dt>
          <dd class="col-sm-7">Unknown</dd>
          <dt class="col-sm-5 text-muted">Partial signatures</dt>
          <dd class="col-sm-7">Unknown</dd>
          <dt class="col-sm-5 text-muted">Final signature</dt>
          <dd class="col-sm-7">Not verified</dd>
          <dt class="col-sm-5 text-muted">Message, aggregate key and participants</dt>
          <dd class="col-sm-7">Unavailable</dd>
        </dl>
      </div>
    </div>
  `,
})
export class MultipartySessionComponent implements OnInit {
  sessionId = '';

  private readonly route = inject(ActivatedRoute);

  ngOnInit(): void {
    this.sessionId = this.route.snapshot.paramMap.get('sessionId') || '';
  }
}
