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
          No insight rule is triggered by the currently loaded evidence.
        </p>
      }
      <p class="soft">Checks use loaded holdings and provider observations. UTXO health, backup history, snapshot history and vault duration are unavailable here.</p>
      <ul>
        @for (insight of insights(); track insight.insightId) {
          <li [attr.data-severity]="insight.severity" [class.dismissed]="dismissed().includes(insight.insightId)">
            <h2>{{ insight.title }}</h2>
            <p>{{ insight.explanation }}</p>
            <p class="calc">{{ insight.calculation }}</p>
            <p class="confidence" i18n="@@universe.portfolio.insights.confidence">
              Rule {{ insight.ruleId }} · confidence: {{ insight.confidence }}
            </p>
            @if (dismissed().includes(insight.insightId)) {
              <p class="soft" role="status" i18n="@@universe.portfolio.insights.dismissed">Dismissed on this page</p>
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
      li.dismissed { border-style: dashed; }
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
  private readonly dataService = inject(PortfolioDataService);
  readonly data = this.dataService.state;
  readonly store = inject(PortfoliosStore);
  readonly portfolioId = input<string>('');
  private readonly openedAt = new Date().toISOString();

  private readonly dismissedSignal = signal<string[]>([]);
  readonly dismissed = this.dismissedSignal.asReadonly();

  readonly insights = computed<readonly PortfolioInsight[]>(() => {
    const state = this.data();
    const aggregation = state.aggregation;
    if (aggregation === null || state.loading) return [];
    return deriveInsights(
      {
        aggregation,
        utxos: [],
        duplicateAddresses: aggregation.duplicateAddresses,
        sourceStates: this.dataService.sourceStates?.() ?? [],
        vaultUnlockedHours: null,
        lastBackupAt: undefined,
        lastSnapshotAt: null,
      },
      state.completedAt || this.openedAt,
    );
  });

  protected dismiss(insight: PortfolioInsight): void {
    this.dismissedSignal.update((current) => [...current, insight.insightId]);
  }

  protected restore(insight: PortfolioInsight): void {
    this.dismissedSignal.update((current) => current.filter((id) => id !== insight.insightId));
  }
}
