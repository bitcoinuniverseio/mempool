/**
 * A single-address historical comparison. It uses the first explicit address
 * in the portfolio that can answer both points and names that address in the
 * result. It does not present one address as a combined portfolio history.
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
import type { PortfolioDelta } from '@app/shared/universe-portfolio-v2.types';

@Component({
  selector: 'app-time-machine',
  standalone: true,
  imports: [PortfolioDataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="machine">
      <header>
        <h1 i18n="@@universe.portfolio.timemachine.title">
          Single-address history comparison
        </h1>
        <p class="soft" i18n="@@universe.portfolio.timemachine.scope-copy">
          This compares the first supported public address in this portfolio. It
          does not combine multiple addresses.
        </p>
      </header>
      <form class="controls" (submit)="compare($event)">
        <label>
          <span i18n="@@universe.portfolio.timemachine.from">From</span>
          <input #fromInput type="date" required />
        </label>
        <label>
          <span i18n="@@universe.portfolio.timemachine.to">To</span>
          <input #toInput type="date" required />
        </label>
        <button
          type="submit"
          class="primary"
          [disabled]="loading()"
          i18n="@@universe.portfolio.timemachine.compare"
        >
          Compare
        </button>
      </form>

      @if (loading()) {
        <p role="status" i18n="@@universe.portfolio.timemachine.working">
          Reconstructing the two historical points…
        </p>
      }

      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }

      @if (delta(); as delta) {
        <section class="result">
          <p class="scope">
            <span i18n="@@universe.portfolio.timemachine.address">Address</span>
            <code>{{ delta.address }}</code>
          </p>
          <header class="endpoints">
            <div>
              <p class="label" i18n="@@universe.portfolio.timemachine.starting">
                Starting priced value
              </p>
              <p class="value">{{ show(delta.from.valuation.pricedValue) }}</p>
            </div>
            <div>
              <p class="label" i18n="@@universe.portfolio.timemachine.ending">
                Ending priced value
              </p>
              <p class="value">{{ show(delta.to.valuation.pricedValue) }}</p>
            </div>
          </header>

          <dl class="effects">
            <div>
              <dt i18n="@@universe.portfolio.timemachine.flows">
                External flow effect
              </dt>
              <dd>{{ effect(delta.externalFlowEffect) }}</dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.timemachine.price">
                Price effect
              </dt>
              <dd>{{ effect(delta.priceEffect) }}</dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.timemachine.fees">Fee effect</dt>
              <dd>{{ effect(delta.feeEffect) }}</dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.timemachine.internal">
                Internal transfers
              </dt>
              <dd>{{ effect(delta.internalTransferEffect) }}</dd>
            </div>
            <div>
              <dt i18n="@@universe.portfolio.timemachine.unresolved">
                Unresolved residual
              </dt>
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
    </div>
  `,
  styles: [
    `
      .machine {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      h1 {
        margin: 0 0 4px;
        font-size: 20px;
      }
      header .soft {
        margin: 0;
      }
      .controls {
        display: flex;
        gap: 12px;
        align-items: end;
        flex-wrap: wrap;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12.5px;
      }
      input {
        min-height: 44px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid var(--u-separator, rgba(0, 0, 0, 0.14));
        font: inherit;
      }
      input:focus,
      input:focus-within {
        outline: 2px solid var(--u-brand, #c40059);
        outline-offset: 2px;
      }
      button {
        min-height: 44px;
        min-width: 44px;
        padding: 8px 16px;
        border-radius: 8px;
        border: 1px solid var(--u-separator, rgba(0, 0, 0, 0.14));
        background: transparent;
        cursor: pointer;
      }
      button.primary {
        background: var(--u-brand, #c40059);
        color: #fff;
        border: none;
        font-weight: 600;
      }
      .result {
        border: 1px solid var(--u-separator, rgba(0, 0, 0, 0.08));
        border-radius: 12px;
        padding: 16px 18px;
      }
      .scope {
        display: flex;
        flex-direction: column;
        gap: 3px;
        margin: 0 0 14px;
        font-size: 12px;
        color: var(--u-fg-soft, inherit);
      }
      .scope code {
        color: var(--u-fg, inherit);
        overflow-wrap: anywhere;
      }
      .endpoints {
        display: flex;
        gap: 32px;
        flex-wrap: wrap;
      }
      .label {
        margin: 0;
        font-size: 12px;
        text-transform: uppercase;
        color: var(--u-fg-soft, inherit);
      }
      .value {
        margin: 4px 0 0;
        font-size: 24px;
        font-variant-numeric: tabular-nums;
      }
      .effects {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px 20px;
        margin-top: 14px;
      }
      dt {
        font-size: 11.5px;
        color: var(--u-fg-soft, inherit);
      }
      dd {
        margin: 2px 0 0;
        font-size: 15px;
        font-variant-numeric: tabular-nums;
      }
      .movements {
        margin-top: 12px;
        font-size: 13.5px;
      }
      .movements p {
        margin: 2px 0;
      }
      .state-row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 12px;
      }
      .warning {
        font-size: 12.5px;
        color: #8a6100;
        background: rgba(180, 120, 0, 0.07);
        padding: 6px 10px;
        border-radius: 6px;
      }
      .error {
        color: #a02020;
      }
      .soft {
        color: var(--u-fg-soft, inherit);
        font-size: 13px;
      }
      @media (max-width: 767px) {
        input {
          font-size: 16px;
        }
      }
    `,
  ],
})
export class TimeMachineComponent implements OnInit {
  readonly store = inject(PortfoliosStore);
  readonly session = inject(PortfolioSessionService);
  private readonly api = inject(PortfolioV2ApiService);
  readonly portfolioId = input<string>('');

  private readonly deltaSignal = signal<PortfolioDelta | null>(null);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal('');

  readonly delta = this.deltaSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  private loaded = false;

  ngOnInit(): void {
    if (this.loaded) return;
    this.loaded = true;
    void this.loadDefault();
  }

  private async loadDefault(): Promise<void> {
    // Default comparison: 30 days ago to now.
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    await this.run(
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10)
    );
  }

  protected compare(event: Event): void {
    event.preventDefault();
    const inputs = (event.target as HTMLFormElement).querySelectorAll('input');
    const from = (inputs[0] as HTMLInputElement).value;
    const to = (inputs[1] as HTMLInputElement).value;
    if (from.length === 0 || to.length === 0) return;
    void this.run(from, to);
  }

  private async run(from: string, to: string): Promise<void> {
    const portfolio = this.store.activePortfolio();
    if (portfolio === null) return;
    this.loadingSignal.set(true);
    this.errorSignal.set('');
    let lastError = '';
    for (const account of portfolio.accounts) {
      for (const address of account.addresses ?? []) {
        try {
          const delta = await firstValueFrom(
            this.api.getDelta$(
              account.chain,
              account.network,
              address,
              { timestamp: `${from}T00:00:00Z` },
              { timestamp: `${to}T00:00:00Z` }
            )
          );
          this.deltaSignal.set(delta);
          this.loadingSignal.set(false);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : '';
        }
      }
    }
    this.loadingSignal.set(false);
    this.errorSignal.set(
      lastError.length > 0
        ? lastError
        : $localize`:@@universe.portfolio.timemachine.no-history:No account on this portfolio supports historical reconstruction yet. Bitcoin mainnet addresses do.`
    );
  }

  protected show(value: string): string {
    if (this.session.valuesHidden()) return maskedValue();
    return `${formatExact(value, 'en', { maximumFractionDigits: 2 })} ${this.store.activePortfolio()?.quoteCurrency ?? 'USD'}`;
  }

  protected effect(value: string | null): string {
    if (value === null) {
      return $localize`:@@universe.portfolio.timemachine.unknown:Unknown - named, not zero`;
    }
    if (this.session.valuesHidden()) return maskedValue();
    return `${formatExact(value, 'en', { maximumFractionDigits: 2 })}`;
  }
}
