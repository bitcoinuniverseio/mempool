/**
 * The Time Machine: compare any two points and explain the change - flow,
 * price, quantity, fees, coverage, and the unresolved residual, each kept
 * separate. Historical gaps stay explicit; the comparison never silently
 * falls back to current holdings.
 */

import { ChangeDetectionStrategy, Component, effect, untracked, inject, input, signal } from '@angular/core';
import { catchError, concatMap, from, map, of, Subscription, timeout } from 'rxjs';
import { accountReadScope, matchesAccount } from '../data/account-read-scope';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioSessionService } from '../stores/session.service';
import { PortfolioDataStateComponent } from '../shared/data-state.component';
import { formatExact, maskedValue } from '../shared/exact';
import type { PortfolioDelta } from '@app/shared/universe-portfolio-v2.types';

@Component({
  selector: 'app-time-machine',
  standalone: true,
  imports: [PortfolioDataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="machine">
      <form class="controls" (submit)="compare($event)">
        <label>
          <span i18n="@@universe.portfolio.timemachine.from">From</span>
          <input #fromInput type="date" required [value]="fromDate()" (input)="editDate('from', fromInput.value)" />
        </label>
        <label>
          <span i18n="@@universe.portfolio.timemachine.to">To</span>
          <input #toInput type="date" required [value]="toDate()" (input)="editDate('to', toInput.value)" />
        </label>
        <button type="submit" class="primary" [disabled]="loading()" i18n="@@universe.portfolio.timemachine.compare">Compare</button>
      </form>

      @if (loading()) {
        <p role="status" i18n="@@universe.portfolio.timemachine.working">Reconstructing the two historical points…</p>
      }

      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }

      <p class="soft">Comparisons are per public address at 00:00 UTC on each selected date. They are not summed into portfolio performance.</p>
      @for (warning of warnings(); track $index) { <p class="warning">{{ warning }}</p> }
      @for (result of results(); track result.key) {
        <h2>{{ result.scope }}</h2>
        @if (result.error) { <p role="note">{{ result.error }}</p> }
        @if (result.delta; as delta) {
        <section class="result">
          <header class="endpoints">
            <div>
              <p class="label" i18n="@@universe.portfolio.timemachine.starting">Starting priced value</p>
              <p class="value">{{ show(delta.from.valuation.pricedValue, delta.from.valuation.quoteCurrency) }}</p>
            </div>
            <div>
              <p class="label" i18n="@@universe.portfolio.timemachine.ending">Ending priced value</p>
              <p class="value">{{ show(delta.to.valuation.pricedValue, delta.to.valuation.quoteCurrency) }}</p>
            </div>
          </header>

          <p>Effects in {{ delta.from.valuation.quoteCurrency }}; no cross-address netting.</p>
          <dl class="effects">
            <div>
              <dt i18n="@@universe.portfolio.timemachine.flows">External flow effect</dt>
              <dd>{{ effect(delta.externalFlowEffect) }}</dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.timemachine.price">Price effect</dt>
              <dd>{{ effect(delta.priceEffect) }}</dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.timemachine.fees">Fee effect</dt>
              <dd>{{ effect(delta.feeEffect) }}</dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.timemachine.internal">Internal transfers</dt>
              <dd>{{ effect(delta.internalTransferEffect) }}</dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.timemachine.unresolved">Unresolved residual</dt>
              <dd>{{ effect(delta.unresolvedEffect) }}</dd>
            </div>
          </dl>

          @if (delta.acquired.length > 0 || delta.disposed.length > 0) {
            <div class="movements">
              <p i18n="@@universe.portfolio.timemachine.acquired">
                Acquired: {{ delta.acquired.length }} holding(s)
              </p>
              <p i18n="@@universe.portfolio.timemachine.disposed">
                Disposed: {{ delta.disposed.length }} holding(s)
              </p>
            </div>
          }

          <p class="state-row">
            <app-portfolio-data-state [state]="delta.from.state" />
            <span>→</span>
            <app-portfolio-data-state [state]="delta.to.state" />
          </p>

          @for (warning of delta.warnings; track warning) {
            <p class="warning" role="note">{{ warning }}</p>
          }
        </section>
        }
      }
    </div>
  `,
  styles: [
    `
      .machine { display: flex; flex-direction: column; gap: 16px; }
      .controls { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
      label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
      input { min-height: 40px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); font: inherit; }
      button { min-height: 40px; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); background: transparent; cursor: pointer; }
      button.primary { background: var(--u-brand, #c40059); color: #fff; border: none; font-weight: 600; }
      .result { border: 1px solid var(--u-separator, rgba(0,0,0,0.08)); border-radius: 12px; padding: 16px 18px; }
      .endpoints { display: flex; gap: 32px; flex-wrap: wrap; }
      .label { margin: 0; font-size: 12px; text-transform: uppercase; color: var(--u-fg-soft, inherit); }
      .value { margin: 4px 0 0; font-size: 24px; font-variant-numeric: tabular-nums; }
      .effects { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 20px; margin-top: 14px; }
      dt { font-size: 11.5px; color: var(--u-fg-soft, inherit); }
      dd { margin: 2px 0 0; font-size: 15px; font-variant-numeric: tabular-nums; }
      .movements { margin-top: 12px; font-size: 13.5px; }
      .movements p { margin: 2px 0; }
      .state-row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
      .warning { font-size: 12.5px; color: #8a6100; background: rgba(180, 120, 0, 0.07); padding: 6px 10px; border-radius: 6px; }
      .error { color: #a02020; }
      .soft { color: var(--u-fg-soft, inherit); font-size: 13px; }
    `,
  ],
})
export class TimeMachineComponent {
  readonly store = inject(PortfoliosStore);
  readonly session = inject(PortfolioSessionService);
  private readonly api = inject(PortfolioV2ApiService);
  readonly portfolioId = input<string>('');

  readonly fromDate = signal(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  readonly toDate = signal(new Date().toISOString().slice(0, 10));
  readonly loading = signal(false);
  readonly error = signal('');
  readonly warnings = signal<readonly string[]>([]);
  readonly results = signal<readonly { key: string; scope: string; delta: PortfolioDelta | null; error: string }[]>([]);
  private request?: Subscription;

  constructor() {
    effect(cleanup => {
      this.store.activePortfolio();
      untracked(() => this.run(this.fromDate(), this.toDate()));
      cleanup(() => this.request?.unsubscribe());
    });
  }

  editDate(which: 'from' | 'to', value: string): void {
    this.request?.unsubscribe();
    this.results.set([]); this.loading.set(false); this.error.set(''); this.warnings.set([]);
    (which === 'from' ? this.fromDate : this.toDate).set(value);
  }

  protected compare(event: Event): void {
    event.preventDefault();
    this.run(this.fromDate(), this.toDate());
  }

  private run(fromDate: string, toDate: string): void {
    this.request?.unsubscribe();
    this.results.set([]); this.loading.set(false); this.error.set('');
    const scope = accountReadScope(this.store.activePortfolio());
    this.warnings.set(scope.warnings);
    const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
    if (!valid(fromDate) || !valid(toDate) || fromDate > toDate || toDate > new Date().toISOString().slice(0, 10)) {
      this.error.set('Choose valid dates in order, no later than today (UTC).'); return;
    }
    if (!scope.targets.length) { this.error.set('No public addresses are available for historical reconstruction.'); return; }
    this.results.set(scope.targets.map(target => ({ key: target.key, scope: `${target.accounts.join(', ')} · ${target.chain}/${target.network} · ${target.address}`, delta: null, error: 'Pending' })));
    this.loading.set(true);
    this.request = from(scope.targets).pipe(concatMap(target => this.api.getDelta$(target.chain, target.network, target.address,
      { timestamp: `${fromDate}T00:00:00Z` }, { timestamp: `${toDate}T00:00:00Z` }).pipe(
      timeout(15000),
      map(delta => {
        if (!matchesAccount(delta, target) || !matchesAccount(delta.from, target) || !matchesAccount(delta.to, target)
          || delta.from.requestedPoint?.timestamp !== `${fromDate}T00:00:00Z` || delta.to.requestedPoint?.timestamp !== `${toDate}T00:00:00Z`
          || typeof delta.from.valuation?.quoteCurrency !== 'string' || delta.from.valuation.quoteCurrency !== delta.to.valuation?.quoteCurrency) throw Error('Mismatched comparison');
        return { target, delta, error: '' };
      }),
      catchError(() => of({ target, delta: null, error: 'Historical comparison unavailable or invalid for this address; coverage is incomplete.' })),
    ))).subscribe({
      next: result => this.results.update(rows => rows.map(row => row.key === result.target.key ? { ...row, delta: result.delta, error: result.error } : row)),
      complete: () => this.loading.set(false),
    });
  }

  protected show(value: string, currency: string): string {
    if (this.session.valuesHidden()) return maskedValue();
    return `${formatExact(value, 'en', { maximumFractionDigits: 2 })} ${currency}`;
  }

  protected effect(value: string | null): string {
    if (value === null) {
      return $localize`:@@universe.portfolio.timemachine.unknown:Unknown - named, not zero`;
    }
    if (this.session.valuesHidden()) return maskedValue();
    return `${formatExact(value, 'en', { maximumFractionDigits: 2 })}`;
  }
}
