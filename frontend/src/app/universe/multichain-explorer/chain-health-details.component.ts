import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ChainCapabilityEnvelope } from '../universe.types';
import { ChainHealthService } from '../chain-health.service';
import { healthDiagnostics, healthServiceSummary, readHealth } from './chain-health';
import { describeChainReasons } from './chain-reasons';

@Component({
  selector: 'app-chain-health-details',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p role="status" *ngIf="!capability">Current health is unknown. <button type="button" (click)="health.retry()">Retry status</button></p>
    <details *ngIf="capability">
      <summary>Service details · {{ summary(capability) }}</summary>
      <p *ngIf="!readHealth(capability)">Independent health is unavailable in this report. Node synchronization is unknown.</p>
      <section *ngFor="let row of diagnostics(capability)">
        <strong>{{ row.name }}</strong>
        <p>{{ row.state }}. {{ row.effect }}</p>
        <p>{{ row.observation }}</p>
        <p *ngIf="row.checkpoint">{{ row.checkpoint }}</p>
        <ul *ngIf="row.reasons.length"><li *ngFor="let reason of row.reasons">{{ reason }}</li></ul>
      </section>
      <ul *ngIf="capability.degradedReasons?.length"><li *ngFor="let reason of reasons(capability.degradedReasons)">{{ reason.text }}</li></ul>
      <button type="button" (click)="health.retry()">Refresh status</button>
    </details>
  `,
  styles: [`
    :host { display: block; min-width: 0; color: var(--u-text-secondary); font-size: var(--u-text-sm); }
    details { padding: var(--u-space-3); border: 1px solid var(--u-border); border-radius: var(--u-radius-md); }
    summary { cursor: pointer; min-height: 44px; overflow-wrap: anywhere; }
    section { margin-top: var(--u-space-3); border-top: 1px solid var(--u-border); padding-top: var(--u-space-2); }
    p, li, strong { overflow-wrap: anywhere; white-space: normal; }
    p { margin-bottom: var(--u-space-1); }
    ul { padding-left: var(--u-space-4); }
    button { color: var(--u-text-primary); background: var(--u-surface-sunken); border: 1px solid var(--u-border); border-radius: var(--u-radius-md); min-height: 44px; padding: var(--u-space-2); }
    button:focus-visible, summary:focus-visible { outline: 2px solid var(--u-focus-ring); outline-offset: 2px; }
  `],
})
export class ChainHealthDetailsComponent {
  @Input() capability: ChainCapabilityEnvelope | null | undefined;
  readonly diagnostics = healthDiagnostics;
  readonly summary = healthServiceSummary;
  readonly reasons = describeChainReasons;
  readonly readHealth = readHealth;
  constructor(public health: ChainHealthService) {}
}
