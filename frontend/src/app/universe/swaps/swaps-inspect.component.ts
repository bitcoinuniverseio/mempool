import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-swaps-inspect',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Private Swap Package Inspector</h1>
        <p class="text-muted">Analyze swap packages in local browser memory. No private data or preimages are ever transmitted.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/swaps">Overview</a>
          <a class="nav-link" routerLink="/swaps/submarine">Submarine</a>
          <a class="nav-link" routerLink="/swaps/reverse">Reverse</a>
          <a class="nav-link" routerLink="/swaps/chain">Chain Swaps</a>
          <a class="nav-link" routerLink="/swaps/providers">Providers</a>
          <a class="nav-link active" routerLink="/swaps/inspect">Inspector</a>
          <a class="nav-link" routerLink="/swaps/recover">Recovery Planner</a>
          <a class="nav-link" routerLink="/swaps/simulate">Simulator</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Paste Swap JSON or Boltz/Loop Package</h5>
        <div class="mb-3">
          <textarea class="form-control font-monospace" rows="6" placeholder='{"id": "swp-...", "preimageHash": "...", "lockupAddress": "..."}'></textarea>
        </div>
        <button class="btn btn-primary align-self-start">Verify Contract Terms Locally</button>
      </div>
    </div>
  `,
})
export class SwapsInspectComponent {}
