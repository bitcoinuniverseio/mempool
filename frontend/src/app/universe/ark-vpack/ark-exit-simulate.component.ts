import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-ark-exit-simulate',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Unilateral Exit Fee & Delay Simulator</h1>
        <p class="text-muted">Simulate worst-case network congestion and fee spikes during VTXO unilateral exit execution.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/ark/vpack">Overview</a>
          <a class="nav-link" routerLink="/ark/vpack/verify">Verify Anchor</a>
          <a class="nav-link" routerLink="/ark/vpack/translate">Translate Dialect</a>
          <a class="nav-link" routerLink="/ark/backups">Encrypted Backups</a>
          <a class="nav-link" routerLink="/ark/exit">Unilateral Exit</a>
          <a class="nav-link active" routerLink="/ark/exit/simulate">Exit Simulator</a>
          <a class="nav-link" routerLink="/ark/providers">ASP Registry</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Exit Simulation Parameters</h5>
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label small">Target Fee Rate (sat/vB)</label>
            <input type="number" class="form-control" value="25" min="1">
          </div>
          <div class="col-md-6">
            <label class="form-label small">Tree Depth (Hops to Leaf)</label>
            <input type="number" class="form-control" value="2" min="1" max="6">
          </div>
          <div class="col-12">
            <button class="btn btn-outline-primary">Compute Worst-Case Fee Impact</button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ArkExitSimulateComponent {}
