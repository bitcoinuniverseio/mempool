/**
 * Performance: portfolio-level FIFO P&L per account, with the existing
 * server methodology and honest states for unproven history.
 */

import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { catchError, concatMap, from, map, of, take, timeout } from 'rxjs';
import { accountReadScope, matchesAccount } from '../data/account-read-scope';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioSessionService } from '../stores/session.service';
import { PortfolioDataStateComponent } from '../shared/data-state.component';
import { formatExact, maskedValue } from '../shared/exact';
import type { PortfolioPerformanceReport } from '@app/shared/universe-portfolio-v2.types';

@Component({
  selector: 'app-portfolio-performance',
  standalone: true,
  imports: [PortfolioDataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="performance">
      @if (loading()) { <p role="status">Reading performance evidence…</p> }
      @for (warning of warnings(); track $index) { <p role="note">{{ warning }}</p> }
      @for (read of reads(); track read.key) { <p>{{ read.scope }}: {{ read.status }}</p> }
      @if (reports().length === 0) {
        <p class="soft" i18n="@@universe.portfolio.performance.empty">
          Performance needs complete proven history. Bitcoin mainnet accounts report FIFO
          profit and loss over their whole proven transaction history; other chains answer
          honestly that they are not covered yet.
        </p>
      }
      @for (report of reports(); track report.chain + ":" + report.network + ":" + report.address) {
        <section class="report">
          <header>
            <h2 class="mono">{{ report.chain }}/{{ report.network }} · {{ report.address.slice(0, 14) }}…</h2>
            <app-portfolio-data-state [state]="report.sourceState" />
          </header>
          <dl class="stats">
            <div>
              <dt i18n="@@universe.portfolio.performance.realized">Realized P&L</dt>
              <dd>{{ session.valuesHidden() ? masked() : money(report.realizedPnl, report.quoteCurrency) }}</dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.performance.unrealized">Unrealized P&L</dt>
              <dd>{{ session.valuesHidden() ? masked() : money(report.unrealizedPnl, report.quoteCurrency) }}</dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.performance.total">Total</dt>
              <dd>{{ session.valuesHidden() ? masked() : money(report.totalPnl, report.quoteCurrency) }}</dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.performance.fees">Fees</dt>
              <dd>{{ session.valuesHidden() ? masked() : money(report.fees, report.quoteCurrency) }}</dd>
            </div>
          </dl>
          <p class="methodology">{{ report.methodology }}</p>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .performance { display: flex; flex-direction: column; gap: 14px; }
      .report { border: 1px solid var(--u-separator, rgba(0,0,0,0.08)); border-radius: 12px; padding: 14px 16px; }
      header { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      h2 { margin: 0; font-size: 14px; }
      .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px 20px; margin: 12px 0 0; }
      dt { font-size: 11.5px; color: var(--u-fg-soft, inherit); }
      dd { margin: 2px 0 0; font-size: 16px; font-variant-numeric: tabular-nums; }
      .methodology { font-size: 12px; color: var(--u-fg-soft, inherit); }
      .mono { font-family: monospace; }
      .soft { color: var(--u-fg-soft, inherit); font-size: 13px; }
    `,
  ],
})
export class PerformanceComponent {
  readonly store = inject(PortfoliosStore);
  readonly session = inject(PortfolioSessionService);
  private readonly api = inject(PortfolioV2ApiService);
  readonly portfolioId = input<string>('');

  private readonly reportsSignal = signal<readonly PortfolioPerformanceReport[]>([]);
  readonly reports = this.reportsSignal.asReadonly();
  readonly loading = signal(false);
  readonly warnings = signal<readonly string[]>([]);
  readonly reads = signal<readonly { key: string; scope: string; status: string }[]>([]);

  constructor() {
    effect(cleanup => {
      const scope = accountReadScope(this.store.activePortfolio());
      this.reportsSignal.set([]);
      this.warnings.set(scope.warnings);
      this.reads.set(scope.targets.map(target => ({ key: target.key, scope: target.accounts.join(', ') + ' · ' + target.chain + '/' + target.network + ' · ' + target.address, status: 'Pending' })));
      this.loading.set(scope.targets.length > 0);
      const sub = from(scope.targets).pipe(concatMap(target => this.api.getPerformance$(target.chain, target.network, target.address).pipe(
        take(1), timeout(15000),
        map(report => {
          if (!matchesAccount(report, target) || !matchesAccount(report.account, target)
            || !/^[A-Z]{3}$/.test(report.quoteCurrency) || !Array.isArray(report.warnings)) throw Error('Mismatched performance');
          return { target, report };
        }),
        catchError(() => of({ target, report: null })),
      ))).subscribe({
        next: ({ target, report }) => {
          this.reads.update(rows => rows.map(row => row.key === target.key ? { ...row, status: report ? 'Answered; source state disclosed below' : 'Unavailable or invalid; performance coverage unknown' } : row));
          if (report) {
            this.reportsSignal.update(rows => [...rows, report]);
            this.warnings.update(rows => [...rows, ...report.warnings.map(warning => target.accounts.join(', ') + ': ' + warning)]);
          }
        },
        complete: () => this.loading.set(false),
      });
      cleanup(() => sub.unsubscribe());
    });
  }

  protected money(value: string | null, currency: string): string {
    if (value === null) return '-';
    return `${formatExact(value, 'en', { maximumFractionDigits: 2 })} ${currency}`;
  }

  protected masked(): string {
    return maskedValue();
  }
}
