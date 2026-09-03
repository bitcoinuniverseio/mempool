/**
 * The legacy public single-address route, rendered through the shared
 * Portfolio Intelligence components in ephemeral single-address mode.
 * Nothing about the visit is stored: no vault record, no history entry.
 */

import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfolioSessionService } from '../stores/session.service';
import { PortfolioDataStateComponent } from '../shared/data-state.component';
import { atomicToDisplay, formatExact, maskedValue, truncateIdentifier } from '../shared/exact';
import type {
  PortfolioSemanticActivityPage,
  PortfolioV2HoldingsPage,
  PortfolioV2SummaryResponse,
} from '@app/shared/universe-portfolio-v2.types';

@Component({
  selector: 'app-ephemeral-portfolio',
  standalone: true,
  imports: [RouterLink, PortfolioDataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <header class="head">
        <p class="crumb">
          <a routerLink="/portfolio" i18n="@@universe.portfolio.ephemeral.back">Portfolio Intelligence</a>
          <span> · </span>
          <span i18n="@@universe.portfolio.ephemeral.mode">Ephemeral view - nothing is saved</span>
        </p>
        <h1 class="address" i18n="@@universe.portfolio.ephemeral.address-title">Address portfolio</h1>
        <p class="mono">{{ session.valuesHidden() ? masked() : truncated() }}</p>
      </header>

      @if (failure(); as failure) {
        <p class="error" role="alert">{{ failure }}</p>
        <a routerLink="/portfolio" i18n="@@universe.portfolio.ephemeral.back-home">Back to Portfolio Intelligence</a>
      } @else if (summary(); as summary) {
        <section class="hero">
          <div>
            <p class="label" i18n="@@universe.portfolio.ephemeral.value">Priced value</p>
            <p class="value">
              @if (session.valuesHidden()) { <span class="masked">{{ masked() }}</span> }
              @else { {{ formatExact(summary.valuation.pricedValue, 'en') }} <span class="quote">{{ summary.valuation.quoteCurrency }}</span> }
            </p>
          </div>
          <app-portfolio-data-state [state]="summary.aggregateState" />
        </section>

        <section aria-label="Holdings">
          <h2 i18n="@@universe.portfolio.ephemeral.holdings">Holdings</h2>
          @if (holdings(); as holdingsPage) {
            <table>
              <thead>
                <tr>
                  <th scope="col" i18n="@@universe.portfolio.ephemeral.asset">Asset</th>
                  <th scope="col" i18n="@@universe.portfolio.ephemeral.quantity">Quantity</th>
                  <th scope="col" i18n="@@universe.portfolio.ephemeral.value">Value</th>
                  <th scope="col" i18n="@@universe.portfolio.ephemeral.state">State</th>
                </tr>
              </thead>
              <tbody>
                @for (entry of holdingsPage.holdings; track entry.holding.assetKey) {
                  <tr>
                    <td>{{ entry.holding.displayName ?? entry.holding.assetKey }}</td>
                    <td>{{ session.valuesHidden() ? masked() : quantityLabel(entry.holding.quantityAtomic, entry.holding.decimals) }}</td>
                    <td>{{ session.valuesHidden() ? masked() : (entry.holding.value !== undefined ? formatExact(entry.holding.value, 'en') : '-') }}</td>
                    <td><app-portfolio-data-state [state]="entry.holding.sourceState" /></td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>

        <section aria-label="Recent activity">
          <h2 i18n="@@universe.portfolio.ephemeral.activity">Recent activity</h2>
          @if (activity(); as activity) {
            <ul class="events">
              @for (event of activity.events.slice(0, 10); track event.eventId) {
                <li>
                  <span class="event-desc">{{ describe(event) }}</span>
                  @if (event.timestamp !== null) {
                    <time class="event-time">{{ event.timestamp }}</time>
                  }
                </li>
              }
            </ul>
          }
          <p class="soft" i18n="@@universe.portfolio.ephemeral.save-hint">
            Want this address tracked with labels, history, and a vault? <a routerLink="/portfolio/new">Create a portfolio</a>.
          </p>
        </section>
      } @else {
        <p role="status" i18n="@@universe.portfolio.ephemeral.loading">Loading the address evidence…</p>
      }
    </div>
  `,
  styles: [
    `
      .wrap { max-width: 960px; margin: 0 auto; padding: 16px 8px; display: flex; flex-direction: column; gap: 18px; }
      .crumb { font-size: 12.5px; color: var(--u-fg-soft, inherit); }
      .address { margin: 4px 0 0; font-size: 18px; }
      .mono { font-family: monospace; font-size: 13px; word-break: break-all; }
      .hero { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 20px; border-radius: 14px; border: 1px solid var(--u-separator, rgba(0,0,0,0.08)); }
      .label { margin: 0; font-size: 12px; text-transform: uppercase; color: var(--u-fg-soft, inherit); }
      .value { margin: 4px 0 0; font-size: 28px; font-variant-numeric: tabular-nums; }
      .masked { letter-spacing: 2px; }
      table { width: 100%; border-collapse: collapse; font-size: 13.5px; font-variant-numeric: tabular-nums; }
      th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--u-separator, rgba(0,0,0,0.06)); }
      .events { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; }
      .events li { display: flex; justify-content: space-between; gap: 12px; }
      .event-time { color: var(--u-fg-soft, inherit); font-size: 12px; }
      .error { color: #a02020; }
      .soft { font-size: 13px; color: var(--u-fg-soft, inherit); }
    `,
  ],
})
export class EphemeralPortfolioComponent implements OnInit {
  readonly session = inject(PortfolioSessionService);
  private readonly api = inject(PortfolioV2ApiService);
  private readonly route = inject(ActivatedRoute);

  private readonly summarySignal = signal<PortfolioV2SummaryResponse | null>(null);
  private readonly holdingsSignal = signal<PortfolioV2HoldingsPage | null>(null);
  private readonly activitySignal = signal<PortfolioSemanticActivityPage | null>(null);
  private readonly failureSignal = signal('');

  readonly summary = this.summarySignal.asReadonly();
  readonly holdings = this.holdingsSignal.asReadonly();
  readonly activity = this.activitySignal.asReadonly();
  readonly failure = this.failureSignal.asReadonly();

  private readonly chain = computed(() => this.route.snapshot.paramMap.get('chain') ?? '');
  private readonly network = computed(() => this.route.snapshot.paramMap.get('network') ?? '');
  private readonly address = computed(() => this.route.snapshot.paramMap.get('address') ?? '');

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [summary, holdings, activity] = await Promise.all([
        firstValueFrom(this.api.getSummary$(this.chain(), this.network(), this.address())),
        firstValueFrom(this.api.getHoldings$(this.chain(), this.network(), this.address(), undefined, 100)),
        firstValueFrom(this.api.getActivity$(this.chain(), this.network(), this.address())),
      ]);
      this.summarySignal.set(summary);
      this.holdingsSignal.set(holdings);
      this.activitySignal.set(activity);
    } catch (error) {
      this.failureSignal.set(
        error instanceof Error
          ? error.message
          : $localize`:@@universe.portfolio.ephemeral.failed:The address evidence could not be read.`,
      );
    }
  }

  protected truncated(): string {
    return truncateIdentifier(this.address(), 14, 10);
  }

  protected quantityLabel(quantity: string | null, decimals?: number): string {
    if (quantity === null) return '-';
    const display = atomicToDisplay(quantity, decimals ?? 8);
    return display === null ? '-' : formatExact(display, 'en');
  }

  protected formatExact(value: string, locale: string): string {
    return formatExact(value, locale);
  }

  protected describe(event: PortfolioSemanticActivityPage['events'][number]): string {
    switch (event.eventType) {
      case 'receive':
        return $localize`:@@universe.portfolio.ephemeral.received:Received an incoming transfer.`;
      case 'send':
        return $localize`:@@universe.portfolio.ephemeral.sent:Sent an outgoing transfer.`;
      case 'internal-transfer':
        return $localize`:@@universe.portfolio.ephemeral.internal:Moved between its own outputs.`;
      case 'coinbase-reward':
        return $localize`:@@universe.portfolio.ephemeral.coinbase:Coinbase reward.`;
      default:
        return $localize`:@@universe.portfolio.ephemeral.unknown:Activity recorded.`;
    }
  }

  protected masked(): string {
    return maskedValue();
  }
}
