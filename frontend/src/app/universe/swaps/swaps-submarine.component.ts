import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@app/shared/shared.module';
import { RouterModule } from '@angular/router';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-swaps-submarine',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ['.text-muted { color: var(--u-text-muted) !important; }'],
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Submarine Swap Verification</h1>
        <p class="text-muted">On-chain Bitcoin funding to Lightning invoice settlement verification.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/swaps' | relativeUrl">Overview</a>
          <a class="nav-link active" [routerLink]="'/swaps/submarine' | relativeUrl">Submarine</a>
          <a class="nav-link" [routerLink]="'/swaps/reverse' | relativeUrl">Reverse</a>
          <a class="nav-link" [routerLink]="'/swaps/chain' | relativeUrl">Chain Swaps</a>
          <a class="nav-link" [routerLink]="'/swaps/providers' | relativeUrl">Providers</a>
          <a class="nav-link" [routerLink]="'/swaps/inspect' | relativeUrl">Inspector</a>
          <a class="nav-link" [routerLink]="'/swaps/recover' | relativeUrl">Recovery Planner</a>
          <a class="nav-link" [routerLink]="'/swaps/simulate' | relativeUrl">Simulator</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Submarine Lockup Lifecycle & Cryptographic Invariants</h5>
        <div class="row g-3">
          <div class="col-md-4">
            <div class="p-3 border rounded bg-body">
              <span class="badge bg-primary mb-2">Stage 1</span>
              <h6>Invoice Commitment</h6>
              <p class="small text-muted mb-0">Lightning invoice payment hash is committed into a standard Taproot script tree.</p>
            </div>
          </div>
          <div class="col-md-4">
            <div class="p-3 border rounded bg-body">
              <span class="badge bg-primary mb-2">Stage 2</span>
              <h6>On-Chain Lockup</h6>
              <p class="small text-muted mb-0">User sends funds to lockup address. Preimage revelation by provider enables claim.</p>
            </div>
          </div>
          <div class="col-md-4">
            <div class="p-3 border rounded bg-body">
              <span class="badge bg-primary mb-2">Stage 3</span>
              <h6>Settlement or Refund</h6>
              <p class="small text-muted mb-0">If invoice expires without payment, refund path unlocks after timeout height.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SwapsSubmarineComponent {}
