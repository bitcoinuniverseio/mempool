/**
 * Portfolio-wide semantic activity: one timeline across all included
 * accounts, grouped by confirmation state, with internal transfers shown
 * as movement and never as economic flow.
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { PortfolioDataService } from '../data/portfolio-data.service';
import { PortfolioSessionService } from '../stores/session.service';
import { PortfolioDataStateComponent } from '../shared/data-state.component';
import { atomicToDisplay, formatExact, maskedValue } from '../shared/exact';
import type { PortfolioDataState } from '@app/shared/universe-portfolio-v2.types';

type EventKind = 'all' | 'in' | 'out' | 'internal' | 'pending';

@Component({
  selector: 'app-portfolio-activity',
  standalone: true,
  imports: [PortfolioDataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="activity">
      <header class="toolbar" role="group" aria-label="Event filters">
        @for (kind of kinds; track kind.value) {
          <button
            type="button"
            [class.active]="filter() === kind.value"
            [attr.aria-pressed]="filter() === kind.value"
            (click)="filter.set(kind.value)"
          >{{ kind.label }}</button>
        }
      </header>

      @if (rows().length === 0) {
        <p class="soft" i18n="@@universe.portfolio.activity.empty">
          No events in this filter yet. Activity appears as the included accounts confirm movements.
        </p>
      } @else {
        <ul class="timeline">
          @for (row of rows(); track row.key) {
            <li>
              <div class="row">
                <span class="desc">{{ row.description }}</span>
                <span class="value num">
                  @if (row.value !== null) {
                    {{ session.valuesHidden() ? masked() : row.value }}
                  }
                </span>
              </div>
              <div class="meta">
                <app-portfolio-data-state [state]="row.state" />
                <span class="mono">{{ row.txid }}</span>
                @if (row.timestamp !== null) { <time>{{ row.timestamp }}</time> }
                @if (row.fee !== null) {
                  <span i18n="@@universe.portfolio.activity.fee">Fee {{ row.fee }}</span>
                }
              </div>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [
    `
      .activity { display: flex; flex-direction: column; gap: 12px; }
      .toolbar { display: flex; gap: 6px; flex-wrap: wrap; }
      .toolbar button { min-height: 34px; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--u-separator, rgba(0,0,0,0.12)); background: transparent; cursor: pointer; font-size: 12.5px; }
      .toolbar button.active { border-color: var(--u-brand, #c40059); color: var(--u-brand, #c40059); font-weight: 600; }
      .timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .timeline li { padding: 10px 4px; border-bottom: 1px solid var(--u-separator, rgba(0,0,0,0.06)); }
      .row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
      .value { font-variant-numeric: tabular-nums; }
      .meta { display: flex; gap: 10px; align-items: center; margin-top: 4px; font-size: 12px; color: var(--u-fg-soft, inherit); flex-wrap: wrap; }
      .mono { font-family: monospace; }
      .soft { color: var(--u-fg-soft, inherit); font-size: 13px; }
    `,
  ],
})
export class ActivityComponent {
  readonly data = inject(PortfolioDataService).state;
  readonly session = inject(PortfolioSessionService);
  readonly portfolioId = input<string>('');

  readonly filter = signal<EventKind>('all');

  readonly kinds: readonly { value: EventKind; label: string }[] = [
    { value: 'all', label: $localize`:@@universe.portfolio.activity.all:All` },
    { value: 'in', label: $localize`:@@universe.portfolio.activity.incoming:Incoming` },
    { value: 'out', label: $localize`:@@universe.portfolio.activity.outgoing:Outgoing` },
    { value: 'internal', label: $localize`:@@universe.portfolio.activity.internal:Internal` },
    { value: 'pending', label: $localize`:@@universe.portfolio.activity.pending:Pending` },
  ];

  // The aggregation service holds transfers; the events themselves are the
  // account feeds re-derived per portfolio load. The transfer list renders
  // internal movement explicitly so flows and movement never blur.
  readonly rows = computed(() => {
    const aggregation = this.data().aggregation;
    const rows: {
      key: string;
      description: string;
      value: string | null;
      state: PortfolioDataState;
      txid: string;
      timestamp: string | null;
      fee: string | null;
      kind: EventKind;
    }[] = [];
    if (aggregation === null) return rows;
    for (const transfer of aggregation.internalTransfers) {
      rows.push({
        key: `internal:${transfer.txid}`,
        description: $localize`:@@universe.portfolio.activity.internal-row:Internal transfer between tracked accounts (movement, not a gain or loss)`,
        value: transfer.quantityAtomic === null ? null : `${formatExact(atomicToDisplay(transfer.quantityAtomic, 8) ?? '', 'en')} BTC`,
        state: 'proven' as const,
        txid: transfer.txid,
        timestamp: transfer.timestamp,
        fee: transfer.feeAtomic === null ? null : `${formatExact(atomicToDisplay(transfer.feeAtomic, 8) ?? '', 'en')} BTC fee`,
        kind: 'internal',
      });
    }
    const flows: { label: string; value: string | null; kind: EventKind }[] = [
      {
        label: $localize`:@@universe.portfolio.activity.external-in:External inflows over the loaded window`,
        value: aggregation.externalInflowAtomic,
        kind: 'in',
      },
      {
        label: $localize`:@@universe.portfolio.activity.external-out:External outflows over the loaded window`,
        value: aggregation.externalOutflowAtomic,
        kind: 'out',
      },
    ];
    for (const flow of flows) {
      rows.push({
        key: flow.kind,
        description: flow.label,
        value: flow.value === null ? null : `${formatExact(atomicToDisplay(flow.value, 8) ?? '', 'en')} BTC`,
        state: (flow.value === null ? 'partial' : 'proven') as PortfolioDataState,
        txid: '',
        timestamp: null,
        fee: null,
        kind: flow.kind,
      });
    }
    const filter = this.filter();
    return rows.filter((row) => filter === 'all' || row.kind === filter);
  });

  protected masked(): string {
    return maskedValue();
  }
}
