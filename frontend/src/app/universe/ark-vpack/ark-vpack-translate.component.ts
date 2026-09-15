import { FormsModule } from '@angular/forms';
import { ArkPackageToolComponent } from './ark-package-tool.component';
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-ark-vpack-translate',
  standalone: true,
  imports: [FormsModule, ArkPackageToolComponent, RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>V-PACK Dialect Translator</h1>
        <p class="text-muted">Convert supported native proofs without losing fields. Bark and Arkade native proofs each round-trip through MVV envelopes. Direct cross-protocol conversion rejects incompatible signed transaction templates.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/ark/vpack' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/ark/vpack/verify' | relativeUrl">Verify Anchor</a>
          <a class="nav-link active" [routerLink]="'/ark/vpack/translate' | relativeUrl">Translate Dialect</a>
          <a class="nav-link" [routerLink]="'/ark/backups' | relativeUrl">Encrypted Backups</a>
          <a class="nav-link" [routerLink]="'/ark/exit' | relativeUrl">Unilateral Exit</a>
          <a class="nav-link" [routerLink]="'/ark/exit/simulate' | relativeUrl">Exit Simulator</a>
          <a class="nav-link" [routerLink]="'/ark/providers' | relativeUrl">ASP Registry</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Dialect Translation Sandbox</h5>
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label small" for="ark-vpack-source-format">Source Package Format</label>
            <select class="form-select" id="ark-vpack-source-format" [(ngModel)]="source">
              <option value="arkade">Arkade Native</option>
              <option value="bark">Bark Native (ark-lib 0.7.1)</option>
              <option value="mvv">MVV with preserved native proof</option>
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label small" for="ark-vpack-target-format">Target Output Format</label>
            <select class="form-select" id="ark-vpack-target-format" [(ngModel)]="target">
              <option value="mvv">MVV with preserved native proof</option>
              <option value="arkade">Arkade Native</option>
              <option value="bark">Bark Native</option>
            </select>
          </div>
          <div class="col-12">
            <textarea class="form-control font-monospace" rows="6" [(ngModel)]="packageJson" aria-label="Source VTXO package JSON" i18n-aria-label placeholder='{"vtxoId": "...", "amount": 500000, "aspKey": "..."}'></textarea>
          </div>
          <div class="col-12">
            <app-ark-package-tool operation="dialects/translate" label="Translate & Verify Preserved Fields" [input]="requestJson" [hideInput]="true"></app-ark-package-tool>
          </div>
        </div>
      </div>
      <div class="card p-4 bg-body-tertiary border mt-3"><h5>Native V-PACK Reconstruction</h5><p>Reconstruction is a separate operation. Cross-dialect conversion requires compatible, complete source data.</p><app-ark-package-tool></app-ark-package-tool></div>
    </div>
  `,
})
export class ArkVpackTranslateComponent {
  source = 'bark'; target = 'mvv'; packageJson = '';
  get requestJson(): string {
    if (!this.packageJson.trim()) return '';
    try { return JSON.stringify({ source_dialect: this.source, target_dialect: this.target, package: JSON.parse(this.packageJson) }); }
    catch { return this.packageJson; }
  }
}
