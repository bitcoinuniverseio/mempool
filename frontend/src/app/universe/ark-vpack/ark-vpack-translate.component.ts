import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-ark-vpack-translate',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>V-PACK Dialect Translator</h1>
        <p class="text-muted">Lossless cross-translation between Arkade, Bark, and Minimal Viable VTXO (MVV) envelopes.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/ark/vpack">Overview</a>
          <a class="nav-link" routerLink="/ark/vpack/verify">Verify Anchor</a>
          <a class="nav-link active" routerLink="/ark/vpack/translate">Translate Dialect</a>
          <a class="nav-link" routerLink="/ark/backups">Encrypted Backups</a>
          <a class="nav-link" routerLink="/ark/exit">Unilateral Exit</a>
          <a class="nav-link" routerLink="/ark/exit/simulate">Exit Simulator</a>
          <a class="nav-link" routerLink="/ark/providers">ASP Registry</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Dialect Translation Sandbox</h5>
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label small">Source Package Format</label>
            <select class="form-select">
              <option value="arkade">Arkade Native (Rust libvpack)</option>
              <option value="bark">Bark Native (Go ASP)</option>
              <option value="mvv">Minimal Viable VTXO (MVV v0.1.0)</option>
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label small">Target Output Format</label>
            <select class="form-select">
              <option value="mvv">Minimal Viable VTXO (MVV v0.1.0)</option>
              <option value="arkade">Arkade Native</option>
              <option value="bark">Bark Native</option>
            </select>
          </div>
          <div class="col-12">
            <textarea class="form-control font-monospace" rows="6" placeholder='{"vtxoId": "...", "amount": 500000, "aspKey": "..."}'></textarea>
          </div>
          <div class="col-12">
            <button class="btn btn-primary">Translate & Verify Preserved Fields</button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ArkVpackTranslateComponent {}
