import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-ark-exit',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Unilateral Exit Planner</h1>
        <p class="text-muted">Compute off-chain tree exit transactions, CSV delays, fee anchors, and CPFP packages.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/ark/vpack">Overview</a>
          <a class="nav-link" routerLink="/ark/vpack/verify">Verify Anchor</a>
          <a class="nav-link" routerLink="/ark/vpack/translate">Translate Dialect</a>
          <a class="nav-link" routerLink="/ark/backups">Encrypted Backups</a>
          <a class="nav-link active" routerLink="/ark/exit">Unilateral Exit</a>
          <a class="nav-link" routerLink="/ark/exit/simulate">Exit Simulator</a>
          <a class="nav-link" routerLink="/ark/providers">ASP Registry</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Exit Path Verification Matrix</h5>
        <div class="alert alert-info">
          Unilateral exit guarantees sovereign recovery even if the ASP vanishes or halts cooperative processing.
        </div>
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Transaction</th>
                <th>Delay Requirement</th>
                <th>Fee Acceleration</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>Round Anchor Spend</td>
                <td>0 Blocks</td>
                <td>Package RBF / V3</td>
                <td><span class="badge bg-success">Ready</span></td>
              </tr>
              <tr>
                <td>2</td>
                <td>VTXO Leaf Claim</td>
                <td>512 Blocks (CSV)</td>
                <td>CPFP via Ephemeral Anchor</td>
                <td><span class="badge bg-warning text-dark">Timelocked</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class ArkExitComponent {}
