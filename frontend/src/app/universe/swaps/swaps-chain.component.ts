import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-swaps-chain',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Cross-Chain Atomic Swap Verification</h1>
        <p class="text-muted">Direct atomic swaps between Bitcoin mainnet, Liquid Network, and Ark protocol.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/swaps">Overview</a>
          <a class="nav-link" routerLink="/swaps/submarine">Submarine</a>
          <a class="nav-link" routerLink="/swaps/reverse">Reverse</a>
          <a class="nav-link active" routerLink="/swaps/chain">Chain Swaps</a>
          <a class="nav-link" routerLink="/swaps/providers">Providers</a>
          <a class="nav-link" routerLink="/swaps/inspect">Inspector</a>
          <a class="nav-link" routerLink="/swaps/recover">Recovery Planner</a>
          <a class="nav-link" routerLink="/swaps/simulate">Simulator</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Atomic HTLC & PTLC Cross-Chain Invariants</h5>
        <div class="table-responsive">
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
                <td>144 blocks</td>
                <td><span class="badge bg-success">Active</span></td>
              </tr>
              <tr>
                <td>Bitcoin Mainnet</td>
                <td>Ark VTXO</td>
                <td>VHTLC Covenant Tree</td>
                <td>288 blocks</td>
                <td><span class="badge bg-info">Pilot</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class SwapsChainComponent {}
