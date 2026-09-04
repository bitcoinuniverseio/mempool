import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-ark-vpack-verify',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Verify V-PACK Public Anchor</h1>
        <p class="text-muted">Validate on-chain round anchor transactions, output indices, and CSV lock durations.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/ark/vpack">Overview</a>
          <a class="nav-link active" routerLink="/ark/vpack/verify">Verify Anchor</a>
          <a class="nav-link" routerLink="/ark/vpack/translate">Translate Dialect</a>
          <a class="nav-link" routerLink="/ark/backups">Encrypted Backups</a>
          <a class="nav-link" routerLink="/ark/exit">Unilateral Exit</a>
          <a class="nav-link" routerLink="/ark/exit/simulate">Exit Simulator</a>
          <a class="nav-link" routerLink="/ark/providers">ASP Registry</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Anchor Outpoint Verification</h5>
        <div class="input-group mb-3">
          <input type="text" class="form-control font-monospace" placeholder="txid:vout (e.g. 3b4c5d6e...:0)" value="3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c:0">
          <button class="btn btn-primary">Check On-Chain Status</button>
        </div>
        <div class="alert alert-success mb-0">
          Anchor confirmed at block height 864150 with 45 confirmations. Output is unspent.
        </div>
      </div>
    </div>
  `,
})
export class ArkVpackVerifyComponent {}
