import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@app/shared/shared.module';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { simulateSwapRollback, SwapSimulationInput } from './swaps-simulation';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-swaps-simulate',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, SharedModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ['.text-muted { color: var(--u-text-muted) !important; }'],
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Atomic Swap Reorg Simulator</h1>
        <p class="text-muted">Explore an explicitly hypothetical Bitcoin rollback and its effect on a Boltz absolute-height refund. No node is contacted.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/swaps' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/swaps/submarine' | relativeUrl">Submarine</a>
          <a class="nav-link" [routerLink]="'/swaps/reverse' | relativeUrl">Reverse</a>
          <a class="nav-link" [routerLink]="'/swaps/chain' | relativeUrl">Chain Swaps</a>
          <a class="nav-link" [routerLink]="'/swaps/providers' | relativeUrl">Providers</a>
          <a class="nav-link" [routerLink]="'/swaps/inspect' | relativeUrl">Inspector</a>
          <a class="nav-link" [routerLink]="'/swaps/recover' | relativeUrl">Recovery Planner</a>
          <a class="nav-link active" [routerLink]="'/swaps/simulate' | relativeUrl">Simulator</a>
        </nav>
      </header>

      <form class="card p-4 bg-body-tertiary border" (ngSubmit)="run()">
        <h2 class="h5">Local rollback scenario</h2>
        <p class="small text-muted">Assumes a rollback to a common ancestor before replacement blocks arrive. Enter hypothetical public values. The fee comparison does not predict actual mempool eviction.</p>
        <div class="row">
          <div class="col-md-6 mb-3"><label for="sim-height">Current block height</label><input id="sim-height" type="number" class="form-control" name="currentHeight" [(ngModel)]="input.currentHeight" (ngModelChange)="clear()" min="1" step="1" required></div>
          <div class="col-md-6 mb-3"><label for="sim-lockup">Lockup inclusion height</label><input id="sim-lockup" type="number" class="form-control" name="lockupHeight" [(ngModel)]="input.lockupHeight" (ngModelChange)="clear()" min="1" step="1" required></div>
          <div class="col-md-6 mb-3"><label for="sim-timeout">Contract refund timeout height</label><input id="sim-timeout" type="number" class="form-control" name="timeoutHeight" [(ngModel)]="input.timeoutHeight" (ngModelChange)="clear()" min="1" step="1" required></div>
          <div class="col-md-6 mb-3"><label for="sim-depth">Rollback depth (blocks)</label><input id="sim-depth" type="number" class="form-control" name="depth" [(ngModel)]="input.depth" (ngModelChange)="clear()" min="0" step="1" required></div>
          <div class="col-md-6 mb-3"><label for="sim-fee">Transaction fee rate (sat/vB)</label><input id="sim-fee" type="number" class="form-control" name="feeRate" [(ngModel)]="input.feeRate" (ngModelChange)="clear()" min="0.01" step="0.01" required></div>
          <div class="col-md-6 mb-3"><label for="sim-threshold">Hypothetical fee threshold (sat/vB)</label><input id="sim-threshold" type="number" class="form-control" name="feeThreshold" [(ngModel)]="input.feeThreshold" (ngModelChange)="clear()" min="0.01" step="0.01" required></div>
        </div>
        <button class="btn btn-outline-primary align-self-start" type="submit">Run local simulation</button>
      </form>
      <p *ngIf="error" class="alert alert-danger mt-3" role="alert">{{ error }}</p>
      <section *ngIf="result" class="card p-4 mt-3" aria-live="polite">
        <h2 class="h5">Simulation only</h2>
        <p>Common ancestor height: {{ result.ancestorHeight }}. Remaining lockup confirmations: {{ result.confirmations }}.</p>
        <p>{{ result.lockupDisplaced ? 'The lockup is displaced in this scenario.' : 'The lockup remains below the common ancestor in this scenario.' }}</p>
        <p>Absolute refund height condition: {{ result.refundHeightSatisfied ? 'satisfied in this scenario' : 'not satisfied' }}. Blocks until the height condition is restored: {{ result.blocksUntilRefund }}.</p>
        <p>Transaction fee rate is {{ result.belowHypotheticalFeeThreshold ? 'below' : 'at or above' }} the hypothetical threshold. Actual eviction remains unknown.</p>
        <p class="small text-muted">This is not observed chain state, spend verification or a recovery plan. A usable refund also needs a confirmed unspent outpoint, the committed script, a valid signer and current node checks.</p>
      </section>
    </div>
  `,
})
export class SwapsSimulateComponent {
  input: SwapSimulationInput = { currentHeight: 200, lockupHeight: 198, timeoutHeight: 200, depth: 3, feeRate: 10, feeThreshold: 45 };
  result: ReturnType<typeof simulateSwapRollback> | null = null;
  error = '';
  clear(): void { this.result = null; this.error = ''; }
  run(): void { this.clear(); try { this.result = simulateSwapRollback(this.input); } catch (e) { this.error = e instanceof Error ? e.message : 'Invalid simulation parameters.'; } }
}