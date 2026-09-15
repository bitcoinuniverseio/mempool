import { ArkPackageToolComponent } from './ark-package-tool.component';
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-ark-exit-simulate',
  standalone: true,
  imports: [ArkPackageToolComponent, RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Unilateral Exit Fee & Delay Simulator</h1>
        <p class="text-muted">Simulate worst-case network congestion and fee spikes during VTXO unilateral exit execution.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/ark/vpack' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/ark/vpack/verify' | relativeUrl">Verify Anchor</a>
          <a class="nav-link" [routerLink]="'/ark/vpack/translate' | relativeUrl">Translate Dialect</a>
          <a class="nav-link" [routerLink]="'/ark/backups' | relativeUrl">Encrypted Backups</a>
          <a class="nav-link" [routerLink]="'/ark/exit' | relativeUrl">Unilateral Exit</a>
          <a class="nav-link active" [routerLink]="'/ark/exit/simulate' | relativeUrl">Exit Simulator</a>
          <a class="nav-link" [routerLink]="'/ark/providers' | relativeUrl">ASP Registry</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <app-ark-package-tool operation="exit/simulate" label="Compute Package Fee Scenario"></app-ark-package-tool>
      </div>
    </div>
  `,
})
export class ArkExitSimulateComponent {}
