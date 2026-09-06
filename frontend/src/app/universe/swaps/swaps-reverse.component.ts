import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@app/shared/shared.module';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-swaps-reverse',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ['.text-muted { color: var(--u-text-muted) !important; }'],
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Reverse Submarine Swap Verification</h1>
        <p class="text-muted">Lightning payment to on-chain Bitcoin UTXO claim verification.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/swaps' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/swaps/submarine' | relativeUrl">Submarine</a>
          <a class="nav-link active" [routerLink]="'/swaps/reverse' | relativeUrl">Reverse</a>
          <a class="nav-link" [routerLink]="'/swaps/chain' | relativeUrl">Chain Swaps</a>
          <a class="nav-link" [routerLink]="'/swaps/providers' | relativeUrl">Providers</a>
          <a class="nav-link" [routerLink]="'/swaps/inspect' | relativeUrl">Inspector</a>
          <a class="nav-link" [routerLink]="'/swaps/recover' | relativeUrl">Recovery Planner</a>
          <a class="nav-link" [routerLink]="'/swaps/simulate' | relativeUrl">Simulator</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Reverse Swap Mechanics & Claim Verification</h5>
        <p class="text-muted">
          In a reverse swap, the provider locks on-chain UTXO collateral first. The user reveals their secret preimage to claim the on-chain UTXO, allowing the provider to settle the associated Lightning payment. That settlement requires separate evidence.
        </p>
        <div class="alert alert-info mb-0">
          Check the lockup script, value, timeout and confirmations before revealing a preimage. Public chain evidence alone does not prove Lightning settlement.
        </div>
      </div>
    </div>
  `,
})
export class SwapsReverseComponent {}
