/**
 * Performance: portfolio-level FIFO P&L per account, with the existing
 * server methodology and honest states for unproven history.
 */

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioSessionService } from '../stores/session.service';
import { PortfolioDataStateComponent } from '../shared/data-state.component';
import { formatExact, maskedValue } from '../shared/exact';
import {
  completedRequestState,
  type PortfolioRequestState,
} from '../shared/request-state';
import type { PortfolioPerformanceReport } from '@app/shared/universe-portfolio-v2.types';

@Component({
  selector: 'app-portfolio-performance',
  standalone: true,
  imports: [PortfolioDataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="performance">
      @if (requestState() === 'loading') {
        <p class="soft" role="status">Reading performance history…</p>
      }
      @if (requestState() === 'error' || requestState() === 'partial') {
        <section class="failure" role="alert">
          <strong
            >Performance data could not be read for {{ failedCount() }}
            {{ failedCount() === 1 ? 'address' : 'addresses' }}.</strong
          >
          <p>
            {{
              requestState() === 'partial'
                ? 'Reports shown below exclude unavailable accounts and are not a complete portfolio result.'
                : 'No performance result is available. This failure is not an empty history.'
            }}
          </p>
        </section>
      }
      @if (requestState() === 'ready' && reports().length === 0) {
        <p class="soft" i18n="@@universe.portfolio.performance.empty">
          Performance needs complete proven history. Bitcoin mainnet accounts
          report FIFO profit and loss over their whole proven transaction
          history; other chains answer honestly that they are not covered yet.
        </p>
      }
      @for (report of reports(); track report.address) {
        <section class="report">
          <header>
            <h2 class="mono">{{ report.address.slice(0, 14) }}…</h2>
            <app-portfolio-data-state [state]="report.sourceState" />
          </header>
          <dl class="stats">
            <div>
              <dt i18n="@@universe.portfolio.performance.realized">
                Realized P&L
              </dt>
              <dd>
                {{
                  session.valuesHidden() ? masked() : money(report.realizedPnl)
                }}
              </dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.performance.unrealized">
                Unrealized P&L
              </dt>
              <dd>
                {{
                  session.valuesHidden()
                    ? masked()
                    : money(report.unrealizedPnl)
                }}
              </dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.performance.total">Total</dt>
              <dd>
                {{ session.valuesHidden() ? masked() : money(report.totalPnl) }}
              </dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.performance.fees">Fees</dt>
              <dd>
                {{ session.valuesHidden() ? masked() : money(report.fees) }}
              </dd>
            </div>
          </dl>
          <p class="methodology">{{ report.methodology }}</p>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .performance {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .report {
        border: 1px solid var(--u-separator, rgba(0, 0, 0, 0.08));
        border-radius: 12px;
        padding: 14px 16px;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      h2 {
        margin: 0;
        font-size: 14px;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 10px 20px;
        margin: 12px 0 0;
      }
      dt {
        font-size: 11.5px;
        color: var(--u-fg-soft, inherit);
      }
      dd {
        margin: 2px 0 0;
        font-size: 16px;
        font-variant-numeric: tabular-nums;
      }
      .methodology {
        font-size: 12px;
        color: var(--u-fg-soft, inherit);
      }
      .mono {
        font-family: monospace;
      }
      .soft {
        color: var(--u-fg-soft, inherit);
        font-size: 13px;
      }
      .failure {
        border: 1px solid
          var(--u-evidence-unavailable-border, rgba(160, 40, 40, 0.4));
        border-radius: 10px;
        padding: 12px 14px;
        background: var(--u-evidence-unavailable-bg, rgba(160, 40, 40, 0.07));
        font-size: 13px;
      }
      .failure p {
        margin: 4px 0 0;
        color: var(--u-fg-soft, inherit);
      }
    `,
  ],
})
export class PerformanceComponent implements OnInit {
  readonly store = inject(PortfoliosStore);
  readonly session = inject(PortfolioSessionService);
  private readonly api = inject(PortfolioV2ApiService);
  readonly portfolioId = input<string>('');

  private readonly reportsSignal = signal<
    readonly PortfolioPerformanceReport[]
  >([]);
  readonly reports = this.reportsSignal.asReadonly();
  private readonly requestStateSignal =
    signal<PortfolioRequestState>('loading');
  readonly requestState = this.requestStateSignal.asReadonly();
  private readonly failedCountSignal = signal(0);
  readonly failedCount = this.failedCountSignal.asReadonly();
  private loaded = false;

  ngOnInit(): void {
    if (this.loaded) return;
    this.loaded = true;
    void this.load();
  }

  private async load(): Promise<void> {
    const portfolio = this.store.activePortfolio();
    if (portfolio === null) {
      this.requestStateSignal.set('ready');
      return;
    }
    const reports: PortfolioPerformanceReport[] = [];
    let successfulCount = 0;
    let failedCount = 0;
    for (const account of portfolio.accounts) {
      for (const address of account.addresses ?? []) {
        try {
          reports.push(
            await firstValueFrom(
              this.api.getPerformance$(account.chain, account.network, address)
            )
          );
          successfulCount += 1;
        } catch {
          failedCount += 1;
        }
      }
    }
    this.reportsSignal.set(reports);
    this.failedCountSignal.set(failedCount);
    this.requestStateSignal.set(
      completedRequestState(successfulCount, failedCount)
    );
  }

  protected money(value: string | null): string {
    if (value === null) return '-';
    return `${formatExact(value, 'en', { maximumFractionDigits: 2 })} USD`;
  }

  protected masked(): string {
    return maskedValue();
  }
}
