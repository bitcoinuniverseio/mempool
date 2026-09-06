import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@app/shared/shared.module';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-swaps-chain',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ['.text-muted { color: var(--u-text-muted) !important; }'],
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Cross-Chain Atomic Swap Verification</h1>
        <p class="text-muted">Cross-chain protocol catalog. Each network and proof format requires its own configured authority.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/swaps' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/swaps/submarine' | relativeUrl">Submarine</a>
          <a class="nav-link" [routerLink]="'/swaps/reverse' | relativeUrl">Reverse</a>
          <a class="nav-link active" [routerLink]="'/swaps/chain' | relativeUrl">Chain Swaps</a>
          <a class="nav-link" [routerLink]="'/swaps/providers' | relativeUrl">Providers</a>
          <a class="nav-link" [routerLink]="'/swaps/inspect' | relativeUrl">Inspector</a>
          <a class="nav-link" [routerLink]="'/swaps/recover' | relativeUrl">Recovery Planner</a>
          <a class="nav-link" [routerLink]="'/swaps/simulate' | relativeUrl">Simulator</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Atomic HTLC & PTLC Cross-Chain Invariants</h5>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Atomic HTLC &amp; PTLC Cross-Chain Invariants, scroll horizontally" i18n-aria-label>
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Origin Network</th>
                <th>Target Network</th>
                <th>Primitive</th>
                <th>Timeout Safety Margin</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Bitcoin Mainnet</td>
                <td>Liquid L-BTC</td>
                <td>Taproot HTLC / Elements PSET</td>
                <td>Unverified</td>
                <td><span class="badge bg-secondary">Proof adapter unavailable</span></td>
              </tr>
              <tr>
                <td>Bitcoin Mainnet</td>
                <td>Ark VTXO</td>
                <td>VHTLC Covenant Tree</td>
                <td>Unverified</td>
                <td><span class="badge bg-secondary">Proof adapter unavailable</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class SwapsChainComponent {}
