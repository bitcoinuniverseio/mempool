/**
 * The redacted report builder: choose sections, redaction level, and
 * detail; preview exactly what will be exposed; render print-ready HTML,
 * CSV, or evidence JSON entirely client-side.
 */

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
import { PortfolioDataService } from '../data/portfolio-data.service';
import { PortfolioSessionService } from '../stores/session.service';
import { formatExact, truncateIdentifier } from '../shared/exact';
import { PortfolioShareService, PortfolioShareSummary } from '../share/portfolio-share.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { manualPositionValue } from '../manual/manual-positions';

type AddressMode = 'included' | 'truncated' | 'removed';
type ValueMode = 'absolute' | 'percentages';

@Component({
  selector: 'app-report-builder',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="builder">
      <h1 i18n="@@universe.portfolio.reports.title">Redacted report</h1>
      <p class="soft" i18n="@@universe.portfolio.reports.copy">
        Downloads render in this browser from the loaded evidence.
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
          @if (manualRows().length > 0) {
            <p class="soft">No address-derived holdings loaded. Manual positions are listed separately below.</p>
          } @else {
            <p class="soft" i18n="@@universe.portfolio.reports.no-data">Load portfolio data first.</p>
          }
        } @else {
          <table>
            <thead>
              <tr>
                <th scope="col" i18n="@@universe.portfolio.reports.asset">Asset</th>
                <th scope="col" i18n="@@universe.portfolio.reports.holding">Holding</th>
                <th scope="col" i18n="@@universe.portfolio.reports.share">Share</th>
                <th scope="col" i18n="@@universe.portfolio.reports.value">Value</th>
              </tr>
            </thead>
            <tbody>
              @for (row of reportRows(); track row.asset) {
                <tr>
                  <td>{{ row.asset }}</td>
                  <td>{{ row.holding }}</td>
                  <td>{{ row.share }}</td>
                  <td>{{ row.value }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      @if (manualRows().length > 0) {
        <section class="preview manual-preview" aria-label="Manual report preview">
          <h2>Manual positions</h2>
          <p class="soft">User-entered quantities and unit prices, as of the dates shown. These estimates are not verified balances or market prices. Positions and currencies stay separate from address-derived holdings and from each other; no combined total or allocation is claimed.</p>
          <div class="table-wrap"><table>
            <thead><tr><th scope="col">Position</th><th scope="col">Type</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Currency</th><th scope="col">Estimated value</th><th scope="col">As of</th></tr></thead>
            <tbody>@for (row of manualRows(); track row.id) {
              <tr><td>{{ row.name }}</td><td>{{ row.kind }}</td><td>{{ row.quantity }}</td><td>{{ row.unitPrice }}</td><td>{{ row.quoteCurrency }}</td><td>{{ row.displayValue }}</td><td>{{ row.effectiveAt }}</td></tr>
            }</tbody>
          </table></div>
        </section>
      }

      <div class="actions">
        <button type="button" (click)="print()" i18n="@@universe.portfolio.reports.print">Print / save PDF</button>
        <button type="button" [disabled]="reportRows().length === 0 && manualRows().length === 0" (click)="downloadCsv()" i18n="@@universe.portfolio.reports.csv">Download CSV</button>
      </div>

      <section class="preview share-controls" aria-labelledby="share-report-title">
        <h2 id="share-report-title" i18n="@@universe.portfolio.reports.share-title">Encrypted share</h2>
        <p class="soft" i18n="@@universe.portfolio.reports.share-copy">
          Share the asset and percentage columns shown above. Addresses and absolute values are excluded.
          Only encrypted data is uploaded. Anyone with the full link can read it until expiry or revocation.
        </p>
        <div class="options">
          <label>
            <span i18n="@@universe.portfolio.reports.expiry">Expires after</span>
            <select #expiry (change)="shareTtl.set(+$any(expiry.value))" [disabled]="shareBusy()">
              <option value="86400">1 day</option>
              <option value="604800">7 days</option>
              <option value="2592000">30 days</option>
            </select>
          </label>
          <button type="button" (click)="createShare()" [disabled]="shareBusy() || data().loading || !data().completedAt || reportRows().length === 0" i18n="@@universe.portfolio.reports.create-share">Create encrypted link</button>
          <button type="button" (click)="refreshShares()" [disabled]="shareBusy()" i18n="@@universe.portfolio.reports.refresh-shares">Refresh saved shares</button>
        </div>
        @if (shareMessage()) { <p role="status" class="soft">{{ shareMessage() }}</p> }
        @if (shareLink()) {
          <label>
            <span i18n="@@universe.portfolio.reports.full-link">Full recipient link</span>
            <input readonly [value]="shareLink()" (focus)="$any($event.target).select()" />
          </label>
        }
        @for (share of savedShares(); track share.shareId) {
          <div class="saved-share">
            <span class="soft">{{ share.createdAt | date:'short' }} · {{ share.state }} · expires {{ share.expiresAt | date:'short' }}</span>
            <div class="actions">
              @if (share.state === 'active') {
                <button type="button" (click)="showShareLink(share.shareId)" [disabled]="shareBusy()">Show link</button>
              }
              @if (share.state === 'pending') {
                <button type="button" (click)="retryShare(share.shareId)" [disabled]="shareBusy()">Retry upload</button>
              }
              @if (share.state === 'active' || share.state === 'pending') {
                <button type="button" (click)="revokeShare(share.shareId)" [disabled]="shareBusy()">Revoke</button>
              }
            </div>
          </div>
        }
      </section>
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
      .table-wrap { overflow-x: auto; } .manual-preview th, .manual-preview td { overflow-wrap: anywhere; min-width: 60px; }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; }
      .saved-share { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
      input { width: 100%; min-width: 0; min-height: 40px; padding: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); border-radius: 8px; color: inherit; background: transparent; }
      .soft { font-size: 12.5px; color: var(--u-fg-soft, inherit); }
      @media print { .options, .actions, .share-controls { display: none; } .table-wrap { overflow: visible; } .manual-preview table { font-size: 10px; } }
    `,
  ],
})
export class ReportBuilderComponent {
  readonly data = inject(PortfolioDataService).state;
  readonly session = inject(PortfolioSessionService);
  readonly portfolioId = toSignal(combineLatest(inject(ActivatedRoute).pathFromRoot.map((route) => route.paramMap))
    .pipe(map((params) => params.map((value) => value.get('portfolioId')).find(Boolean) ?? '')), { initialValue: '' });
  private readonly shares = inject(PortfolioShareService);
  private readonly store = inject(PortfoliosStore);
  readonly shareTtl = signal(86400);
  readonly shareBusy = signal(false);
  readonly shareMessage = signal('');
  readonly shareLink = signal('');
  readonly savedShares = signal<PortfolioShareSummary[]>([]);

  constructor() {
    effect(() => {
      this.portfolioId();
      this.shareLink.set('');
      this.savedShares.set([]);
      void this.refreshShares();
    });
  }

  async refreshShares(): Promise<void> {
    const portfolioId = this.portfolioId();
    if (!this.shares.unlocked()) {
      this.savedShares.set([]);
      this.shareLink.set('');
      this.shareMessage.set('Unlock the portfolio vault to create or manage shares.');
      return;
    }
    try {
      const shares = await this.shares.list(portfolioId);
      if (this.portfolioId() === portfolioId) { this.savedShares.set(shares); }
    }
    catch { this.shareMessage.set('Saved shares could not be read. Unlock the vault and retry.'); }
  }

  private async shareAction(action: () => Promise<void>, success: string): Promise<void> {
    if (this.shareBusy()) {return;}
    this.shareBusy.set(true);
    const portfolioId = this.portfolioId();
    this.shareLink.set('');
    this.shareMessage.set('Working…');
    try { await action(); if (this.portfolioId() === portfolioId) { this.shareMessage.set(success); } }
    catch { if (this.portfolioId() === portfolioId) { this.shareMessage.set('The share could not be updated. Check that the vault is unlocked and sharing storage is available, then retry. Pending uploads remain saved.'); } }
    finally { this.shareBusy.set(false); await this.refreshShares(); }
  }

  async createShare(): Promise<void> {
    const portfolioId = this.portfolioId();
    const completedAt = this.data().completedAt;
    if (this.data().loading || !completedAt) {return;}
    await this.shareAction(async () => {
      const shareId = await this.shares.create(portfolioId, this.reportRows().map(({ asset, share }) => ({ asset, share })), completedAt, this.shareTtl());
      const link = await this.shares.link(shareId, portfolioId, window.location.origin);
      if (this.portfolioId() === portfolioId) { this.shareLink.set(link); }
    }, 'Encrypted share created. Copy the full recipient link.');
  }

  async retryShare(shareId: string): Promise<void> {
    const portfolioId = this.portfolioId();
    await this.shareAction(async () => {
      await this.shares.retry(shareId, portfolioId);
      const link = await this.shares.link(shareId, portfolioId, window.location.origin);
      if (this.portfolioId() === portfolioId) { this.shareLink.set(link); }
    }, 'Encrypted share uploaded.');
  }

  async revokeShare(shareId: string): Promise<void> {
    await this.shareAction(() => this.shares.revoke(shareId, this.portfolioId()), 'Share revoked. Existing downloaded copies cannot be recalled.');
  }

  async showShareLink(shareId: string): Promise<void> {
    const portfolioId = this.portfolioId();
    await this.shareAction(async () => {
      const link = await this.shares.link(shareId, portfolioId, window.location.origin);
      if (this.portfolioId() === portfolioId) { this.shareLink.set(link); }
    }, 'Copy the full recipient link.');
  }

  readonly addressMode = signal<AddressMode>('truncated');
  readonly valueMode = signal<ValueMode>('absolute');

  readonly manualRows = computed(() => {
    const entries = this.store.portfolios().find(portfolio => portfolio.id === this.portfolioId())?.manualEntries ?? [];
    const hideAmounts = this.session.valuesHidden() || this.valueMode() === 'percentages';
    return entries.map(entry => {
      const exactValue = manualPositionValue(entry);
      return {
        id: entry.id, name: entry.name, kind: entry.kind,
        quantity: hideAmounts ? 'Hidden' : entry.quantity,
        unitPrice: hideAmounts ? 'Hidden' : entry.unitPrice ?? 'Not supplied',
        quoteCurrency: entry.quoteCurrency ?? '', effectiveAt: entry.effectiveAt.slice(0, 10),
        value: hideAmounts ? 'Hidden' : exactValue ?? 'Unpriced',
        displayValue: hideAmounts ? 'Hidden' : exactValue === null ? 'Unpriced' : formatExact(exactValue, 'en'),
      };
    });
  });

  readonly reportRows = computed(() => {
    const aggregation = this.data().aggregation;
    if (aggregation === null) {return [];}
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
            ? reportPercentage(holding.pricedValue, total)
            : formatExact(holding.pricedValue, 'en');
      return {
        asset,
        holding: holdingText,
        share: reportPercentage(holding.pricedValue, total),
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
    const manual = this.manualRows();
    const rows = manual.length === 0 ? [
      ['asset', 'holding', 'share', 'value'], ...this.reportRows().map(row => [row.asset, row.holding, row.share, row.value]),
    ] : [
      ['asset', 'holding', 'share', 'value', 'source', 'kind', 'quantity', 'unit_price', 'quote_currency', 'effective_at'],
      ...this.reportRows().map(row => [row.asset, row.holding, row.share, row.value, 'Address-derived', '', '', '', '', '']),
      ...manual.map(row => [row.name, '', 'Not combined', row.value, 'User-entered', row.kind, row.quantity, row.unitPrice, row.quoteCurrency, row.effectiveAt].map(manualCsvText)),
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

/** Keep user-entered text literal when a downloaded CSV is opened in a spreadsheet. */
function manualCsvText(value: string): string {
  return /^\s*[=+@-]|^[\t\r\n]/.test(value) ? '\'' + value : value;
}

export function reportPercentage(part: string | null, total: string | null): string {
  if (part === null || total === null || !/^\d+(\.\d+)?$/.test(part) || !/^\d+(\.\d+)?$/.test(total)) {return 'Unpriced';}
  const scale = (value: string): bigint => BigInt(value.replace('.', ''));
  if (scale(total) === 0n) {return 'Unavailable';}
  const partScale = part.split('.')[1]?.length ?? 0;
  const totalScale = total.split('.')[1]?.length ?? 0;
  const scaled = (scale(part) * 10n ** BigInt(totalScale) * 10_000n) / (scale(total) * 10n ** BigInt(partScale));
  const whole = scaled / 100n;
  const fraction = (scaled % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  const text = fraction.length === 0 ? `${whole}` : `${whole}.${fraction}`;
  return `${formatExact(text, 'en', { maximumFractionDigits: 2 })}%`;
}
