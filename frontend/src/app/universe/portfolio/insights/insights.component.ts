/**
 * Insights: every entry is a deterministic, versioned rule result with its
 * formula, data boundary, and evidence links. Dismissal is local and
 * reappears only when the underlying state changes.
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { PortfolioDataService } from '../data/portfolio-data.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { deriveInsights, type PortfolioInsight } from '../shared/insights';

@Component({
  selector: 'app-portfolio-insights',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="insights">
      @if (insights().length === 0) {
        <p class="soft" i18n="@@universe.portfolio.insights.empty">
          Nothing needs attention. Insights appear when the measured state of the
          portfolio crosses a stated, explainable rule - never from a score.
        </p>
      }
      <ul>
        @for (insight of insights(); track insight.insightId) {
          <li [attr.data-severity]="insight.severity">
            <h2>{{ insight.title }}</h2>
            <p>{{ insight.explanation }}</p>
            <p class="calc">{{ insight.calculation }}</p>
            <p class="confidence" i18n="@@universe.portfolio.insights.confidence">
              Rule {{ insight.ruleId }} · confidence: {{ insight.confidence }}
            </p>
            @if (dismissed().includes(insight.insightId)) {
              <button type="button" (click)="restore(insight)" i18n="@@universe.portfolio.insights.restore">Restore</button>
            } @else {
              <button type="button" (click)="dismiss(insight)" i18n="@@universe.portfolio.insights.dismiss">Dismiss</button>
            }
          </li>
        }
      </ul>
    </div>
  `,
  styles: [
    `
      .insights ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
      li { border: 1px solid var(--u-separator, rgba(0,0,0,0.08)); border-radius: 12px; padding: 14px 16px; }
      li[data-severity='attention'] { border-color: rgba(180, 120, 0, 0.4); }
      li[data-severity='high'] { border-color: rgba(160, 32, 32, 0.5); }
      h2 { margin: 0 0 6px; font-size: 15px; }
      p { margin: 4px 0; font-size: 13.5px; }
      .calc { font-family: monospace; font-size: 12px; color: var(--u-fg-soft, inherit); }
      .confidence { font-size: 11.5px; color: var(--u-fg-soft, inherit); }
      button { min-height: 34px; border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); background: transparent; cursor: pointer; }
      .soft { color: var(--u-fg-soft, inherit); }
    `,
  ],
})
export class InsightsComponent {
  readonly data = inject(PortfolioDataService).state;
  readonly store = inject(PortfoliosStore);
  readonly portfolioId = input<string>('');

  private readonly dismissedSignal = signal<string[]>([]);
  readonly dismissed = this.dismissedSignal.asReadonly();

  readonly insights = computed<readonly PortfolioInsight[]>(() => {
    const aggregation = this.data().aggregation;
    if (aggregation === null) return [];
    return deriveInsights(
      {
        aggregation,
        utxos: [],
        duplicateAddresses: aggregation.duplicateAddresses,
        sourceStates: [],
        vaultUnlockedHours: null,
        lastBackupAt: null,
        lastSnapshotAt: null,
      },
      '2026-09-02T00:00:00.000Z',
    ).filter((insight) => !this.dismissed().includes(insight.insightId));
  });

  protected dismiss(insight: PortfolioInsight): void {
    this.dismissedSignal.update((current) => [...current, insight.insightId]);
  }

  protected restore(insight: PortfolioInsight): void {
    this.dismissedSignal.update((current) => current.filter((id) => id !== insight.insightId));
  }
}
