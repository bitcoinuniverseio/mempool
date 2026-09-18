import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ChainReasonReading } from './chain-reasons';

/**
 * The list of reasons behind a verdict, each marked with what kind of reason
 * it is.
 *
 * A stated edge of what a working authority covers is not an outage. Printed
 * as an identical bullet beside a real failure it reads as one, which is the
 * confusion this component exists to remove: a warning triangle for something
 * broken, an information mark for a stated limit, a question mark for a code
 * this build carries no sentence for.
 */
@Component({
  selector: 'app-chain-reason-list',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="reason-list">
      <li *ngFor="let reason of reasons; trackBy: trackByCode" [class]="'reason reason--' + reason.kind">
        <span class="reason__icon" aria-hidden="true">
          <svg *ngIf="reason.kind === 'fault'" viewBox="0 0 16 16" width="16" height="16" focusable="false">
            <path d="M8 1.6 15 14H1L8 1.6Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M8 6v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <circle cx="8" cy="12" r="0.9" fill="currentColor"/>
          </svg>
          <svg *ngIf="reason.kind === 'limit'" viewBox="0 0 16 16" width="16" height="16" focusable="false">
            <circle cx="8" cy="8" r="6.7" fill="none" stroke="currentColor" stroke-width="1.4"/>
            <path d="M8 7.2v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <circle cx="8" cy="4.8" r="0.9" fill="currentColor"/>
          </svg>
          <svg *ngIf="reason.kind === 'unstated'" viewBox="0 0 16 16" width="16" height="16" focusable="false">
            <circle cx="8" cy="8" r="6.7" fill="none" stroke="currentColor" stroke-width="1.4"/>
            <path d="M6.3 6.1a1.8 1.8 0 1 1 2.3 1.9c-.4.2-.6.5-.6.9v.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <circle cx="8" cy="11.6" r="0.9" fill="currentColor"/>
          </svg>
        </span>
        <span class="reason__text">
          <span class="visually-hidden" *ngIf="reason.kind === 'fault'" i18n="@@universe.reason.kind.fault">Problem: </span>
          <span class="visually-hidden" *ngIf="reason.kind === 'limit'" i18n="@@universe.reason.kind.limit">Limit: </span>
          <span class="visually-hidden" *ngIf="reason.kind === 'unstated'" i18n="@@universe.reason.kind.unstated">Not explained: </span>
          {{ reason.text }}
        </span>
      </li>
    </ul>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .reason-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--u-space-1); }
    .reason { display: flex; gap: var(--u-space-2); align-items: flex-start; min-width: 0; }
    .reason__icon { display: inline-flex; flex: 0 0 auto; margin-top: 0.1em; }
    .reason__text { min-width: 0; overflow-wrap: anywhere; white-space: normal; }
    .reason--fault .reason__icon { color: var(--u-state-unavailable); }
    .reason--limit .reason__icon { color: var(--u-state-partial); }
    .reason--unstated .reason__icon { color: var(--u-state-neutral); }
    .visually-hidden {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }
  `],
})
export class ChainReasonListComponent {
  @Input() reasons: readonly ChainReasonReading[] = [];
  trackByCode(_index: number, reason: ChainReasonReading): string {
    return reason.code || reason.text;
  }
}
