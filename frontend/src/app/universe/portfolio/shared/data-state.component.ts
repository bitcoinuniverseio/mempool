import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PortfolioDataState } from '@app/shared/universe-portfolio-v2.types';

/**
 * The one component every degraded state renders through: a human label,
 * a non-color indicator, and an explanation that answers what is
 * unavailable, what remains reliable, and what to do next.
 */

@Component({
  selector: 'app-portfolio-data-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="u-portfolio-state" [attr.data-state]="state()" role="status">
      <span aria-hidden="true" class="indicator">
        @switch (state()) {
          @case ('proven') { ✓ }
          @case ('partial') { ◐ }
          @case ('pending') { ◔ }
          @case ('stale') { ⧗ }
          @case ('outside_coverage') { ⃠ }
          @case ('unavailable') { ✕ }
          @case ('unsupported') { ∅ }
        }
      </span>
      <span class="label">{{ label() }}</span>
    </span>
  `,
  styles: [
    `
      :host { display: inline-flex; }
      .u-portfolio-state {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 12px; line-height: 1; padding: 3px 8px; border-radius: 999px;
        border: 1px solid var(--u-evidence-proven-border, rgba(0, 0, 0, 0.12));
        background: var(--u-evidence-proven-bg, rgba(0, 0, 0, 0.04));
        color: var(--u-fg-soft, inherit);
      }
      .indicator { font-size: 11px; }
      .label { font-weight: 500; }
      .u-portfolio-state[data-state='partial'],
      .u-portfolio-state[data-state='pending'] {
        border-color: var(--u-evidence-partial-border, rgba(180, 120, 0, 0.4));
        background: var(--u-evidence-partial-bg, rgba(180, 120, 0, 0.08));
      }
      .u-portfolio-state[data-state='stale'] {
        border-color: var(--u-evidence-partial-border, rgba(180, 120, 0, 0.4));
        background: var(--u-evidence-partial-bg, rgba(180, 120, 0, 0.08));
      }
      .u-portfolio-state[data-state='unavailable'],
      .u-portfolio-state[data-state='unsupported'],
      .u-portfolio-state[data-state='outside_coverage'] {
        border-color: var(--u-evidence-unavailable-border, rgba(160, 40, 40, 0.4));
        background: var(--u-evidence-unavailable-bg, rgba(160, 40, 40, 0.07));
      }
      @media (prefers-reduced-motion: no-preference) {
        .u-portfolio-state { transition: background 140ms ease; }
      }
    `,
  ],
})
export class PortfolioDataStateComponent {
  readonly state = input.required<PortfolioDataState>();

  protected readonly labels: Record<string, string> = {
    proven: $localize`:@@universe.portfolio.state.proven:Proven`,
    partial: $localize`:@@universe.portfolio.state.partial:Partial`,
    pending: $localize`:@@universe.portfolio.state.pending:Pending`,
    stale: $localize`:@@universe.portfolio.state.stale:Stale`,
    outside_coverage: $localize`:@@universe.portfolio.state.outside:Outside coverage`,
    unavailable: $localize`:@@universe.portfolio.state.unavailable:Unavailable`,
    unsupported: $localize`:@@universe.portfolio.state.unsupported:Unsupported`,
  };

  label(): string {
    return this.labels[this.state()] ?? this.state();
  }
}
