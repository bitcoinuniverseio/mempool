import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ChainCapabilityEnvelope } from '../universe.types';
import { ChainHealthService } from '../chain-health.service';
import { healthDiagnostics, healthServiceSummary, readHealth } from './chain-health';
import { describeChainReasons } from './chain-reasons';
import { ChainReasonListComponent } from './chain-reason-list.component';

@Component({
  selector: 'app-chain-health-details',
  standalone: true,
  imports: [CommonModule, ChainReasonListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="unknown" role="status" *ngIf="!capability">
      <span>Current status is unknown.</span>
      <button type="button" (click)="health.retry()" i18n="@@universe.health.check-again">Check again</button>
    </p>
    <details *ngIf="capability">
      <summary><span class="summary__label" i18n="@@universe.health.service-details">Service details</span><span class="summary__state">{{ summary(capability) }}</span></summary>

      <p class="note" *ngIf="!readHealth(capability)" i18n="@@universe.health.no-independent">
        This report carries no independent health check, so the state below is not confirmed.
      </p>

      <section *ngFor="let row of diagnostics(capability); trackBy: trackById">
        <h4 class="row__name">
          {{ row.name }}
          <span class="row__authority" *ngIf="row.authority">{{ row.authority }}</span>
        </h4>
        <p class="row__state">{{ row.state }}</p>
        <p class="row__effect">{{ row.effect }}</p>
        <p class="row__meta">
          <span [title]="row.observedAt || ''">{{ row.observation }}</span>
          <span *ngIf="row.checkpoint" [title]="row.blockHash || ''">
            · {{ row.checkpoint }}<ng-container *ngIf="row.blockHashShort"> · {{ row.blockHashShort }}</ng-container>
          </span>
        </p>
        <app-chain-reason-list *ngIf="row.reasons.length" [reasons]="row.reasons"></app-chain-reason-list>
      </section>

      <section class="overall" *ngIf="capability.degradedReasons?.length">
        <h4 i18n="@@universe.health.overall-reasons">Overall</h4>
        <app-chain-reason-list [reasons]="reasons(capability.degradedReasons)"></app-chain-reason-list>
      </section>

      <button type="button" class="refresh" (click)="health.retry()" i18n="@@universe.health.check-again-2">Check again</button>
    </details>
  `,
  styles: [`
    :host { display: block; min-width: 0; color: var(--u-text-secondary); font-size: var(--u-text-sm); }
    details { padding: var(--u-space-3); border: 1px solid var(--u-border); border-radius: var(--u-radius-md); }
    summary {
      cursor: pointer; min-height: 44px; display: flex; align-items: center;
      flex-wrap: wrap; gap: var(--u-space-2); overflow-wrap: anywhere;
    }
    .summary__label { color: var(--u-text-primary); font-weight: 600; }
    .summary__state { color: var(--u-text-secondary); }
    .unknown { display: flex; align-items: center; flex-wrap: wrap; gap: var(--u-space-2); }
    .note { margin-top: var(--u-space-2); }
    section { margin-top: var(--u-space-3); border-top: 1px solid var(--u-border); padding-top: var(--u-space-2); }
    .row__name { margin: 0 0 var(--u-space-1); font-size: var(--u-text-sm); color: var(--u-text-primary); overflow-wrap: anywhere; }
    .row__authority { color: var(--u-text-muted); font-weight: 400; }
    .row__state { color: var(--u-text-primary); }
    .row__meta { color: var(--u-text-muted); }
    p { margin-bottom: var(--u-space-1); overflow-wrap: anywhere; white-space: normal; }
    app-chain-reason-list { margin-top: var(--u-space-2); }
    button {
      color: var(--u-text-primary); background: var(--u-surface-sunken);
      border: 1px solid var(--u-border); border-radius: var(--u-radius-md);
      min-height: 44px; padding: var(--u-space-2) var(--u-space-3); cursor: pointer;
    }
    .refresh { margin-top: var(--u-space-3); }
    button:hover { background: var(--u-surface-hover); }
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
  trackById(_index: number, row: { id: string }): string {
    return row.id;
  }
}
