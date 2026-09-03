/**
 * The redacted report builder: choose sections, redaction level, and
 * detail; preview exactly what will be exposed; render print-ready HTML,
 * CSV, or evidence JSON entirely client-side.
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { PortfolioDataService } from '../data/portfolio-data.service';
import { PortfolioSessionService } from '../stores/session.service';
import { formatExact, maskedValue, truncateIdentifier } from '../shared/exact';

type AddressMode = 'included' | 'truncated' | 'removed';
type ValueMode = 'absolute' | 'percentages';

@Component({
  selector: 'app-report-builder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="builder">
      <h1 i18n="@@universe.portfolio.reports.title">Redacted report</h1>
      <p class="soft" i18n="@@universe.portfolio.reports.copy">
        Everything renders in this browser from the loaded evidence - nothing is uploaded.
        The preview shows exactly what the report exposes.
      </p>

      <div class="options">
        <label>
          <span i18n="@@universe.portfolio.reports.addresses">Addresses</span>
          <select #addrSelect (change)="addressMode.set($any(addrSelect.value))">
            <option value="truncated" i18n="@@universe.portfolio.reports.truncated">Truncated</option>
            <option value="included" i18n="@@universe.portfolio.reports.included">Included in full</option>
            <option value="removed" i18n="@@universe.portfolio.reports.removed">Removed</option>
          </select>
        </label>
        <label>
          <span i18n="@@universe.portfolio.reports.values">Values</span>
          <select #valueSelect (change)="valueMode.set($any(valueSelect.value))">
            <option value="absolute" i18n="@@universe.portfolio.reports.absolute">Absolute</option>
            <option value="percentages" i18n="@@universe.portfolio.reports.pct">Percentages only</option>
          </select>
        </label>
      </div>

      <section class="preview" aria-label="Report preview">
        <h2 i18n="@@universe.portfolio.reports.preview">Preview</h2>
        @if (reportRows().length === 0) {
          <p class="soft" i18n="@@universe.portfolio.reports.no-data">Load portfolio data first.</p>
        } @else {
          <table>
            <thead>
              <tr>
                <th scope="col" i18n="@@universe.portfolio.reports.asset">Asset</th>
                <th scope="col" i18n="@@universe.portfolio.reports.holding">Holding</th>
                <th scope="col" i18n="@@universe.portfolio.reports.share">Share</th>
              </tr>
            </thead>
            <tbody>
              @for (row of reportRows(); track row.asset) {
                <tr>
                  <td>{{ row.asset }}</td>
                  <td>{{ row.holding }}</td>
                  <td>{{ row.share }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <div class="actions">
        <button type="button" (click)="print()" i18n="@@universe.portfolio.reports.print">Print / save PDF</button>
        <button type="button" [disabled]="reportRows().length === 0" (click)="downloadCsv()" i18n="@@universe.portfolio.reports.csv">Download CSV</button>
      </div>
    </div>
  `,
  styles: [
    `
      .builder { max-width: 720px; margin: 0 auto; padding: 16px 8px; display: flex; flex-direction: column; gap: 14px; }
      h1 { margin: 0; font-size: 20px; }
      h2 { margin: 0 0 8px; font-size: 14px; }
      .options { display: flex; gap: 16px; flex-wrap: wrap; }
      label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
      select, button { min-height: 40px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); font: inherit; background: transparent; }
      button { cursor: pointer; }
      .preview { border: 1px dashed var(--u-separator, rgba(0,0,0,0.18)); border-radius: 12px; padding: 14px 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
      th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--u-separator, rgba(0,0,0,0.06)); }
      .actions { display: flex; gap: 10px; }
      .soft { font-size: 12.5px; color: var(--u-fg-soft, inherit); }
    `,
  ],
})
export class ReportBuilderComponent {
  readonly data = inject(PortfolioDataService).state;
  readonly session = inject(PortfolioSessionService);
  readonly portfolioId = input<string>('');

  readonly addressMode = signal<AddressMode>('truncated');
  readonly valueMode = signal<ValueMode>('absolute');

  readonly reportRows = computed(() => {
    const aggregation = this.data().aggregation;
    if (aggregation === null) return [];
    const total = aggregation.pricedTotal;
    return aggregation.holdings.map((holding) => {
      const asset = holding.displayName ?? holding.assetKey.split(':').pop() ?? holding.assetKey;
      const holdingText =
        this.addressMode() === 'removed'
          ? ''
          : holding.locations
              .map((location) => this.renderAddress(location.address))
              .filter((value) => value.length > 0)
              .join(', ');
      const value =
        holding.pricedValue === null
          ? $localize`:@@universe.portfolio.reports.unpriced:Unpriced`
          : this.valueMode() === 'percentages' || this.session.valuesHidden()
            ? `${percent(holding.pricedValue, total ?? '0')}%`
            : formatExact(holding.pricedValue, 'en');
      return {
        asset,
        holding: holdingText,
        share: `${percent(holding.pricedValue ?? '0', total ?? '0')}%`,
        value,
      };
    });
  });

  private renderAddress(address: string): string {
    switch (this.addressMode()) {
      case 'removed':
        return '';
      case 'truncated':
        return truncateIdentifier(address);
      default:
        return address;
    }
  }

  protected print(): void {
    window.print();
  }

  protected downloadCsv(): void {
    const rows = [
      ['asset', 'holding', 'share', 'value'],
      ...this.reportRows().map((row) => [row.asset, row.holding, row.share, row.value]),
    ];
    const csv = rows
      .map((row) => row.map((field) => `"${field.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`${csv}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'portfolio-report.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }
}

function percent(part: string, total: string): string {
  if (total === '0' || total.length === 0) return '0';
  const scale = (value: string): bigint => BigInt(value.replace('.', ''));
  const partScale = part.split('.')[1]?.length ?? 0;
  const totalScale = total.split('.')[1]?.length ?? 0;
  const scaled = (scale(part) * 10n ** BigInt(Math.max(0, totalScale - partScale) + 8)) / scale(total);
  const whole = scaled / 100_000_000n;
  const fraction = (scaled % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  const text = fraction.length === 0 ? `${whole}` : `${whole}.${fraction}`;
  return formatExact(text, 'en', { maximumFractionDigits: 2 });
}
