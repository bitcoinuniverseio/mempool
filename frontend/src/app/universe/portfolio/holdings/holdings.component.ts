/**
 * Holdings: one product supporting table mode, compact cards on mobile,
 * grouping, expansion with per-location breakdowns, search, and filters.
 * Hiding and pinning are presentation-only and never touch evidence.
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { PortfolioDataService } from '../data/portfolio-data.service';
import { PortfolioSessionService } from '../stores/session.service';
import { PortfolioDataStateComponent } from '../shared/data-state.component';
import { atomicToDisplay, formatExact, maskedValue } from '../shared/exact';
import type { AggregatedHolding } from '../shared/aggregation';

type GroupMode = 'asset' | 'account' | 'chain' | 'protocol' | 'priced';

@Component({
  selector: 'app-portfolio-holdings',
  standalone: true,
  imports: [PortfolioDataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="holdings">
      <header class="toolbar">
        <label class="search">
          <span class="visually-hidden" i18n="@@universe.portfolio.holdings.search-label">Search holdings</span>
          <input
            type="search"
            [value]="query()"
            (input)="query.set(searchInput.value)"
            #searchInput
            i18n-placeholder="@@universe.portfolio.holdings.search-placeholder"
            placeholder="Search by asset, protocol, or location…"
          />
        </label>
        <label class="group">
          <span i18n="@@universe.portfolio.holdings.group">Group</span>
          <select #groupSelect (change)="group.set($any(groupSelect.value))">
            <option value="asset" i18n="@@universe.portfolio.holdings.group-asset">Asset</option>
            <option value="account" i18n="@@universe.portfolio.holdings.group-account">Account</option>
            <option value="chain" i18n="@@universe.portfolio.holdings.group-chain">Chain</option>
            <option value="protocol" i18n="@@universe.portfolio.holdings.group-protocol">Protocol</option>
            <option value="priced" i18n="@@universe.portfolio.holdings.group-priced">Priced / unpriced</option>
          </select>
        </label>
      </header>

      @if (data().loading && rows().length === 0) {
        <p role="status" i18n="@@universe.portfolio.holdings.loading">Loading holdings…</p>
      } @else if (rows().length === 0) {
        <p class="soft" i18n="@@universe.portfolio.holdings.empty">
          No holdings yet. Add accounts, or refresh once the addresses have activity.
        </p>
      } @else {
        <!-- Desktop table -->
        <div class="table-wrap">
          <table>
            <caption class="visually-hidden" i18n="@@universe.portfolio.holdings.caption">
              Holdings with exact quantities, values, and source states
            </caption>
            <thead>
              <tr>
                <th scope="col" i18n="@@universe.portfolio.holdings.col-asset">Asset</th>
                <th scope="col" class="num" i18n="@@universe.portfolio.holdings.col-quantity">Exact quantity</th>
                <th scope="col" class="num" i18n="@@universe.portfolio.holdings.col-value">Priced value</th>
                <th scope="col" class="num" i18n="@@universe.portfolio.holdings.col-share">Share</th>
                <th scope="col" i18n="@@universe.portfolio.holdings.col-state">State</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.holding.assetKey) {
                <tr
                  [class.clickable]="true"
                  (click)="expanded.set(expanded() === row.holding.assetKey ? '' : row.holding.assetKey)"
                  (keydown.enter)="expanded.set(expanded() === row.holding.assetKey ? '' : row.holding.assetKey)"
                  tabindex="0"
                  [attr.aria-expanded]="expanded() === row.holding.assetKey"
                >
                  <td>
                    <strong>{{ row.holding.displayName ?? row.holding.ticker ?? shortKey(row.holding) }}</strong>
                    <span class="sub">{{ row.holding.protocol }}</span>
                  </td>
                  <td class="num">{{ session.valuesHidden() ? masked() : quantity(row.holding) }}</td>
                  <td class="num">
                    {{ session.valuesHidden() ? masked() : (row.holding.pricedValue === null ? '-' : formatExact(row.holding.pricedValue, 'en')) }}
                  </td>
                  <td class="num">{{ row.share }}</td>
                  <td><app-portfolio-data-state [state]="row.holding.state" /></td>
                </tr>
                @if (expanded() === row.holding.assetKey) {
                  <tr class="expanded-row">
                    <td colspan="5">
                      <div class="expansion">
                        <p class="expansion-title" i18n="@@universe.portfolio.holdings.locations">Locations</p>
                        <ul>
                          @for (location of row.holding.locations; track location.reference) {
                            <li class="mono">
                              <span>{{ location.kind === 'outpoint' ? 'Output' : location.kind === 'protocol-ledger' ? 'Protocol ledger' : 'Manual' }}</span>
                              <span>{{ location.reference }}</span>
                              <span>{{ location.quantityAtomic === null ? '-' : quantityText(location.quantityAtomic, row.holding.decimals) }}</span>
                            </li>
                          }
                        </ul>
                        <p class="soft" i18n="@@universe.portfolio.holdings.deep-links">
                          Asset details live on their protocol protocol pages - open them from the activity timeline.
                        </p>
                      </div>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        <!-- Mobile cards -->
        <ul class="cards">
          @for (row of rows(); track row.holding.assetKey) {
            <li>
              <div class="card-head">
                <strong>{{ row.holding.displayName ?? row.holding.ticker ?? shortKey(row.holding) }}</strong>
                <span class="num">{{ session.valuesHidden() ? masked() : (row.holding.pricedValue === null ? '-' : formatExact(row.holding.pricedValue, 'en')) }}</span>
              </div>
              <div class="card-sub">
                <span>{{ quantity(row.holding) }}</span>
                <app-portfolio-data-state [state]="row.holding.state" />
              </div>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [
    `
      .holdings { display: flex; flex-direction: column; gap: 12px; }
      .toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      input, select { min-height: 40px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); font: inherit; }
      .search { flex: 1; min-width: 220px; display: flex; }
      .search input { width: 100%; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; font-size: 13.5px; font-variant-numeric: tabular-nums; }
      th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--u-separator, rgba(0,0,0,0.06)); }
      th { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--u-fg-soft, inherit); }
      .num { text-align: right; }
      tbody tr.clickable { cursor: pointer; }
      tbody tr.clickable:hover { background: var(--u-surface-raised, rgba(0,0,0,0.03)); }
      .sub { display: block; font-size: 11.5px; color: var(--u-fg-soft, inherit); }
      .expanded-row td { background: var(--u-surface-raised, rgba(0,0,0,0.03)); }
      .expansion { padding: 8px 4px; }
      .expansion-title { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; color: var(--u-fg-soft, inherit); }
      .expansion ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
      .expansion li { display: flex; gap: 14px; font-size: 12.5px; justify-content: space-between; flex-wrap: wrap; }
      .mono { font-family: monospace; }
      .cards { display: none; list-style: none; margin: 0; padding: 0; gap: 10px; flex-direction: column; }
      .cards li { border: 1px solid var(--u-separator, rgba(0,0,0,0.1)); border-radius: 12px; padding: 12px; }
      .card-head { display: flex; justify-content: space-between; gap: 8px; }
      .card-sub { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 12.5px; color: var(--u-fg-soft, inherit); font-variant-numeric: tabular-nums; }
      .soft { color: var(--u-fg-soft, inherit); font-size: 13px; }
      .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      @media (max-width: 767px) {
        .table-wrap { display: none; }
        .cards { display: flex; }
      }
    `,
  ],
})
export class HoldingsComponent {
  readonly data = inject(PortfolioDataService).state;
  readonly session = inject(PortfolioSessionService);
  readonly portfolioId = input<string>('');

  readonly query = signal('');
  readonly group = signal<GroupMode>('asset');
  readonly expanded = signal('');

  readonly rows = computed(() => {
    const aggregation = this.data().aggregation;
    if (aggregation === null) return [];
    const query = this.query().toLowerCase();
    return aggregation.holdings
      .filter((holding) => this.matchesGroup(holding))
      .filter((holding) =>
        query.length === 0 ||
        holding.assetKey.toLowerCase().includes(query) ||
        (holding.displayName ?? '').toLowerCase().includes(query) ||
        (holding.ticker ?? '').toLowerCase().includes(query) ||
        holding.protocol.includes(query),
      )
      .map((holding) => ({
        holding,
        share: this.shareOf(holding, aggregation.pricedTotal),
      }))
      .sort((a, b) => (a.holding.assetKey < b.holding.assetKey ? -1 : 1));
  });

  private matchesGroup(holding: AggregatedHolding): boolean {
    switch (this.group()) {
      case 'account':
        return holding.accountIds.length > 0;
      case 'chain':
        return holding.chain.length > 0;
      case 'protocol':
        return holding.protocol !== 'base';
      case 'priced':
        return holding.pricedValue !== null;
      default:
        return true;
    }
  }

  private shareOf(holding: AggregatedHolding, total: string | null): string {
    if (holding.pricedValue === null || total === null || total === '0') return '-';
    const share = percent(holding.pricedValue, total);
    return `${formatExact(share, 'en', { maximumFractionDigits: 2 })}%`;
  }

  protected quantity(holding: AggregatedHolding): string {
    return this.quantityText(holding.quantityAtomic, holding.decimals);
  }

  protected quantityText(quantity: string | null, decimals?: number): string {
    if (quantity === null) return '-';
    const display = atomicToDisplay(quantity, decimals ?? 0);
    return display === null ? '-' : formatExact(display, 'en');
  }

  protected shortKey(holding: AggregatedHolding): string {
    return holding.assetKey.split(':').slice(-1)[0];
  }

  protected formatExact(value: string, locale: string): string {
    return formatExact(value, locale);
  }

  protected masked(): string {
    return maskedValue();
  }
}

function percent(part: string, total: string): string {
  const scale = (value: string): bigint => BigInt(value.replace('.', ''));
  const partScale = part.split('.')[1]?.length ?? 0;
  const totalScale = total.split('.')[1]?.length ?? 0;
  const scaled = (scale(part) * 10n ** BigInt(Math.max(0, totalScale - partScale) + 8)) / scale(total);
  const whole = scaled / 100_000_000n;
  const fraction = (scaled % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction.length === 0 ? `${whole}` : `${whole}.${fraction}`;
}
