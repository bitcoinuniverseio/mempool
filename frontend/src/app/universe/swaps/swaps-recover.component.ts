import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-swaps-recover',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Swap Recovery Planner</h1>
        <p class="text-muted">Generate unsigned PSBT refund transactions for expired or stalled atomic swaps.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/swaps">Overview</a>
          <a class="nav-link" routerLink="/swaps/submarine">Submarine</a>
          <a class="nav-link" routerLink="/swaps/reverse">Reverse</a>
          <a class="nav-link" routerLink="/swaps/chain">Chain Swaps</a>
          <a class="nav-link" routerLink="/swaps/providers">Providers</a>
          <a class="nav-link" routerLink="/swaps/inspect">Inspector</a>
          <a class="nav-link active" routerLink="/swaps/recover">Recovery Planner</a>
          <a class="nav-link" routerLink="/swaps/simulate">Simulator</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Recovery Execution Matrix</h5>
        <div class="row g-3">
          <div class="col-md-6">
            <div class="p-3 border rounded bg-body">
              <h6>Matured Refund Path</h6>
              <p class="small text-muted mb-2">When locktime height is exceeded, you can construct an unsigned refund transaction.</p>
              <span class="badge bg-success">Zero Co-signer Required</span>
            </div>
          </div>
          <div class="col-md-6">
            <div class="p-3 border rounded bg-body">
              <h6>Cooperative Cancellation</h6>
              <p class="small text-muted mb-2">If provider signs cooperative refund, timeout blocks are waived immediately.</p>
              <span class="badge bg-info">Instant Settlement</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SwapsRecoverComponent {}
