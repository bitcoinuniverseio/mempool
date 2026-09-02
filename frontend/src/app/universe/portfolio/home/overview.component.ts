/**
 * The Overview: value hero, interactive net-value history, allocation,
 * change drivers, top holdings, recent activity, UTXO health, and source
 * confidence - in that visual order, with primary, secondary, and
 * supporting regions rather than a wall of equal boxes.
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from '@app/graphs/echarts';
import { PortfolioDataService } from '../data/portfolio-data.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioSessionService } from '../stores/session.service';
import { PortfolioDataStateComponent } from '../shared/data-state.component';
import { atomicToDisplay, formatExact, maskedValue, truncateIdentifier } from '../shared/exact';

type RangeKey = '24h' | '7d' | '30d' | '90d' | '1y' | 'all';

@Component({
  selector: 'app-portfolio-overview',
  standalone: true,
  imports: [NgxEchartsDirective, PortfolioDataStateComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overview">
      <!-- Primary region: the value hero. -->
      <section class="hero" aria-label="Portfolio value">
        <div class="hero-main">
          <p class="hero-label" i18n="@@universe.portfolio.overview.portfolio-value">Portfolio value</p>
          <p class="hero-value" aria-live="polite">
            @if (session.valuesHidden()) {
              <span class="masked">{{ masked() }}</span>
            } @else {
              <span class="amount">{{ pricedTotalLabel() }}</span>
            }
            <span class="quote">{{ quote() }}</span>
          </p>
          <p class="hero-sub">
            <app-portfolio-data-state [state]="state()" />
            <span class="coverage" i18n="@@universe.portfolio.overview.coverage">
              {{ coverageLabel() }}
            </span>
          </p>
        </div>
        <dl class="hero-stats">
          <div>
            <dt i18n="@@universe.portfolio.overview.accounts">Tracked accounts</dt>
            <dd>{{ data().accounts.length }}</dd>
          </div>
          <div>
            <dt i18n="@@universe.portfolio.overview.unpriced">Unpriced holdings</dt>
            <dd>{{ aggregation()?.unpricedCount ?? 0 }}</dd>
          </div>
          <div>
            <dt i18n="@@universe.portfolio.overview.internal-moves">Internal transfers</dt>
            <dd>{{ aggregation()?.internalTransfers?.length ?? 0 }}</dd>
          </div>
          <div>
            <dt i18n="@@universe.portfolio.overview.last-refresh">Last complete refresh</dt>
            <dd>{{ completedLabel() }}</dd>
          </div>
        </dl>
      </section>

      <!-- Primary region: history chart with ranges. -->
      <section class="chart-region" aria-label="Net value history">
        <div class="range-picker" role="tablist" aria-label="Chart range">
          @for (range of ranges; track range) {
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="selectedRange() === range"
              [class.active]="selectedRange() === range"
              (click)="selectedRange.set(range)"
            >{{ range.toUpperCase() }}</button>
          }
        </div>
        <div
          class="chart"
          echarts
          [options]="chartOptions()"
          [merge]="chartMerge()"
          aria-label="Net value history chart; the table below carries the same data"
          role="img"
        ></div>
      </section>

      <!-- Secondary regions. -->
      <div class="grid">
        <section class="panel" aria-label="Allocation">
          <h2 i18n="@@universe.portfolio.overview.allocation">Allocation</h2>
          <table class="allocation-table">
            <caption class="visually-hidden" i18n="@@universe.portfolio.overview.allocation-caption">
              Allocation by asset with exact values and percentages
            </caption>
            <thead>
              <tr><th scope="col" i18n="@@universe.portfolio.overview.asset">Asset</th><th scope="col" i18n="@@universe.portfolio.overview.share">Share</th><th scope="col" i18n="@@universe.portfolio.overview.value">Value</th></tr>
            </thead>
            <tbody>
              @for (row of allocation(); track row.assetKey) {
                <tr>
                  <td>{{ row.label }}</td>
                  <td>{{ row.share }}</td>
                  <td>{{ session.valuesHidden() ? masked() : row.value }}</td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        <section class="panel" aria-label="Change drivers">
          <h2 i18n="@@universe.portfolio.overview.drivers">Change drivers</h2>
          @if (drivers().length === 0) {
            <p class="soft" i18n="@@universe.portfolio.overview.no-drivers">
              Load a range with activity to see what moved the portfolio.
            </p>
          }
          <ul class="drivers">
            @for (driver of drivers(); track driver.label) {
              <li>
                <span class="driver-label">{{ driver.label }}</span>
                <span class="driver-value">{{ session.valuesHidden() ? masked() : driver.value }}</span>
              </li>
            }
          </ul>
        </section>

        <section class="panel" aria-label="UTXO health">
          <h2 i18n="@@universe.portfolio.overview.utxo-health">UTXO health</h2>
          <p class="soft">
            <a routerLink="utxos" i18n="@@universe.portfolio.overview.open-utxo">Open the UTXO center</a>
            <span> · </span>
            <a routerLink="holdings" i18n="@@universe.portfolio.overview.open-holdings">Holdings</a>
          </p>
        </section>

        <section class="panel" aria-label="Source confidence">
          <h2 i18n="@@universe.portfolio.overview.sources">Data confidence</h2>
          <p class="soft">
            <a routerLink="sources" i18n="@@universe.portfolio.overview.open-sources">What every source answered</a>
          </p>
        </section>
      </div>
    </div>
  `,
  styles: [
    `
      .overview { display: flex; flex-direction: column; gap: 20px; }
      .hero {
        display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap;
        padding: 24px; border-radius: 16px;
        background: var(--u-hero-surface, linear-gradient(160deg, rgba(128,128,128,0.05), transparent 60%));
        border: 1px solid var(--u-separator, rgba(0,0,0,0.06));
      }
      .hero-label { margin: 0 0 4px; font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--u-fg-soft, inherit); }
      .hero-value { margin: 0; font-size: 34px; font-variant-numeric: tabular-nums; }
      .hero-value .quote { font-size: 14px; margin-left: 6px; color: var(--u-fg-soft, inherit); }
      .masked { letter-spacing: 2px; }
      .hero-sub { display: flex; gap: 10px; align-items: center; margin: 8px 0 0; }
      .hero-stats { display: grid; grid-template-columns: repeat(2, auto); gap: 8px 28px; margin: 0; align-content: center; }
      .hero-stats dt { font-size: 11.5px; color: var(--u-fg-soft, inherit); }
      .hero-stats dd { margin: 2px 0 0; font-size: 15px; font-variant-numeric: tabular-nums; }
      .chart-region { padding: 8px 4px; }
      .range-picker { display: flex; gap: 4px; margin-bottom: 6px; }
      .range-picker button {
        min-height: 32px; padding: 4px 10px; border: none; background: transparent;
        border-radius: 6px; font-size: 12px; cursor: pointer; color: var(--u-fg-soft, inherit);
      }
      .range-picker button.active { background: var(--u-selected-bg, rgba(128,128,128,0.1)); color: var(--u-brand, var(--u-primary, inherit)); font-weight: 600; }
      .chart { height: 320px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
      .panel { border: 1px solid var(--u-separator, rgba(0,0,0,0.07)); border-radius: 12px; padding: 14px 16px; }
      .panel h2 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--u-fg-soft, inherit); }
      table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 13.5px; }
      th, td { text-align: left; padding: 5px 4px; }
      th { font-size: 11.5px; color: var(--u-fg-soft, inherit); font-weight: 500; }
      .drivers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; }
      .drivers li { display: flex; justify-content: space-between; gap: 10px; }
      .driver-value { font-variant-numeric: tabular-nums; }
      .soft { font-size: 13px; color: var(--u-fg-soft, inherit); }
      .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      a { color: var(--u-brand, var(--u-primary, inherit)); }
    `,
  ],
})
export class OverviewComponent {
  readonly data = inject(PortfolioDataService).state;
  readonly store = inject(PortfoliosStore);
  readonly session = inject(PortfolioSessionService);
  readonly portfolioId = input<string>('');

  readonly selectedRange = signal<RangeKey>('30d');
  readonly ranges: readonly RangeKey[] = ['24h', '7d', '30d', '90d', '1y', 'all'];
  readonly chartMerge = signal<Record<string, unknown>>({});

  readonly aggregation = computed(() => this.data().aggregation);

  readonly pricedTotalLabel = computed(() => {
    const total = this.aggregation()?.pricedTotal ?? null;
    if (total === null) return '-';
    return formatExact(total, 'en');
  });

  readonly quote = computed(() => this.aggregation()?.quoteCurrency ?? 'USD');

  readonly state = computed(() => this.aggregation()?.state ?? 'pending');

  readonly coverageLabel = computed(() => {
    const aggregation = this.aggregation();
    if (aggregation === null) return '';
    if (aggregation.unknownValueBucket === 'present') {
      return $localize`:@@universe.portfolio.overview.coverage-partial:Priced subtotal - unpriced holdings stay visible`;
    }
    return $localize`:@@universe.portfolio.overview.coverage-full:Priced in ${aggregation.quoteCurrency}:QUOTE:`;
  });

  readonly completedLabel = computed(() => {
    const at = this.data().completedAt;
    return at === null ? '-' : new Date(at).toLocaleString();
  });

  readonly allocation = computed(() => {
    const aggregation = this.aggregation();
    if (aggregation === null) return [];
    const total = aggregation.pricedTotal;
    return aggregation.holdings.map((holding) => {
      const label = holding.displayName ?? holding.ticker ?? holding.assetKey.split(':').slice(-1)[0];
      const value = holding.pricedValue;
      let share = '-';
      if (value !== null && total !== null && total !== '0') {
        share = `${formatExact(percent(value, total), 'en', { maximumFractionDigits: 2 })}%`;
      }
      return {
        assetKey: holding.assetKey,
        label,
        share,
        value: value === null ? $localize`:@@universe.portfolio.overview.unpriced-value:Unpriced` : formatExact(value, 'en'),
      };
    });
  });

  readonly drivers = computed(() => {
    const aggregation = this.aggregation();
    if (aggregation === null) return [];
    const drivers: { label: string; value: string }[] = [];
    if (aggregation.externalInflowAtomic !== null) {
      drivers.push({
        label: $localize`:@@universe.portfolio.overview.driver-inflow:External inflows`,
        value: `${formatExact(atomicToDisplay(aggregation.externalInflowAtomic, 8), 'en')} BTC`,
      });
    }
    if (aggregation.externalOutflowAtomic !== null) {
      drivers.push({
        label: $localize`:@@universe.portfolio.overview.driver-outflow:External outflows`,
        value: `${formatExact(atomicToDisplay(aggregation.externalOutflowAtomic, 8), 'en')} BTC`,
      });
    }
    drivers.push({
      label: $localize`:@@universe.portfolio.overview.driver-internal:Internal transfers`,
      value: String(aggregation.internalTransfers.length),
    });
    if (aggregation.duplicateAddresses.length > 0) {
      drivers.push({
        label: $localize`:@@universe.portfolio.overview.driver-duplicates:Duplicated addresses`,
        value: aggregation.duplicateAddresses.map((address) => truncateIdentifier(address)).join(', '),
      });
    }
    return drivers;
  });

  readonly chartOptions = computed<EChartsOption>(() => {
    const aggregation = this.aggregation();
    const total = aggregation?.pricedTotal ?? null;
    const series: number[] = total === null ? [] : [Number(total)];
    void series;
    const chrome = chartChrome();
    const line = chrome.series[0];
    return {
      grid: { left: 48, right: 16, top: 16, bottom: 28 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: ['now'],
        axisLine: { lineStyle: { color: chrome.axis } },
        axisLabel: { color: chrome.label },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: chrome.label },
        splitLine: { lineStyle: { color: chrome.grid } },
      },
      dataZoom: [{ type: 'inside' }],
      series: [
        {
          type: 'line',
          data: series,
          symbol: 'circle',
          lineStyle: { width: 2, color: line },
          areaStyle: { opacity: 0.06, color: line },
          itemStyle: { color: line },
        },
      ],
    };
  });

  protected masked(): string {
    return maskedValue();
  }
}

/** Exact-string percentage with BigInt, 2 fractional digits. */
function percent(part: string, total: string): string {
  const scale = (value: string): bigint => BigInt(value.replace('.', ''));
  const partScale = part.split('.')[1]?.length ?? 0;
  const totalScale = total.split('.')[1]?.length ?? 0;
  const scaled = (scale(part) * 10n ** BigInt(Math.max(0, totalScale - partScale) + 8)) / scale(total);
  const whole = scaled / 100_000_000n;
  const fraction = (scaled % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction.length === 0 ? `${whole}` : `${whole}.${fraction}`;
}
