import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-swaps-simulate',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Atomic Swap Reorg Simulator</h1>
        <p class="text-muted">Simulate deep chain reorgs, race conditions, and fee-spike eviction scenarios.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/swaps">Overview</a>
          <a class="nav-link" routerLink="/swaps/submarine">Submarine</a>
          <a class="nav-link" routerLink="/swaps/reverse">Reverse</a>
          <a class="nav-link" routerLink="/swaps/chain">Chain Swaps</a>
          <a class="nav-link" routerLink="/swaps/providers">Providers</a>
          <a class="nav-link" routerLink="/swaps/inspect">Inspector</a>
          <a class="nav-link" routerLink="/swaps/recover">Recovery Planner</a>
          <a class="nav-link active" routerLink="/swaps/simulate">Simulator</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Reorg Simulation Sandbox</h5>
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label small">Reorg Depth (Blocks)</label>
            <input type="number" class="form-control" value="3" min="1" max="10">
          </div>
          <div class="col-md-6">
            <label class="form-label small">Mempool Eviction Threshold (sat/vB)</label>
            <input type="number" class="form-control" value="45" min="1">
          </div>
          <div class="col-12 mt-3">
            <button class="btn btn-outline-primary">Run Settlement Simulation</button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SwapsSimulateComponent {}
