import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-swaps-reverse',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Reverse Submarine Swap Verification</h1>
        <p class="text-muted">Lightning payment to on-chain Bitcoin UTXO claim verification.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/swaps">Overview</a>
          <a class="nav-link" routerLink="/swaps/submarine">Submarine</a>
          <a class="nav-link active" routerLink="/swaps/reverse">Reverse</a>
          <a class="nav-link" routerLink="/swaps/chain">Chain Swaps</a>
          <a class="nav-link" routerLink="/swaps/providers">Providers</a>
          <a class="nav-link" routerLink="/swaps/inspect">Inspector</a>
          <a class="nav-link" routerLink="/swaps/recover">Recovery Planner</a>
          <a class="nav-link" routerLink="/swaps/simulate">Simulator</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Reverse Swap Mechanics & Claim Verification</h5>
        <p class="text-muted">
          In a reverse swap, the provider locks on-chain UTXO collateral first. The user reveals their secret preimage to claim the on-chain UTXO, automatically finalizing the incoming Lightning payment.
        </p>
        <div class="alert alert-info mb-0">
          Reverse swaps guarantee zero counterparty risk: on-chain lockup tx must confirm before preimage is revealed.
        </div>
      </div>
    </div>
  `,
})
export class SwapsReverseComponent {}
