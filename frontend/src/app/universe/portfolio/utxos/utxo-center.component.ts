/**
 * The UTXO center: read-only inventory, safety classification, effective
 * value economics at a user-selected fee rate, and consolidation analysis.
 * Nothing here signs, selects coins, or represents a local flag as an
 * on-chain lock.
 */

import { ChangeDetectionStrategy, Component, effect, computed, inject, input, signal } from '@angular/core';
import { concatMap, from, of } from 'rxjs';
import { accountReadScope } from '../data/account-read-scope';
import { readUtxoPages } from '../data/read-utxo-pages';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioSessionService } from '../stores/session.service';
import { PortfolioDataStateComponent } from '../shared/data-state.component';
import { formatExact, maskedValue, truncateIdentifier } from '../shared/exact';
import { classifyUtxo, effectiveValue, type UtxoSafetyClass } from '../shared/utxo-safety';
import type { PortfolioUtxo } from '@app/shared/universe-portfolio-v2.types';

@Component({
  selector: 'app-utxo-center',
  standalone: true,
  imports: [PortfolioDataStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="utxo">
      <header class="toolbar">
        <label class="fee">
          <span i18n="@@universe.portfolio.utxo.fee-rate">Fee rate (sat/vB)</span>
          <input #feeInput type="number" min="1" step="1" [value]="feeRate()" (input)="feeRate.set(feeInput.value)" />
        </label>
        <label class="dust">
          <span i18n="@@universe.portfolio.utxo.dust-threshold">Dust threshold (sats)</span>
          <input #dustInput type="number" min="0" step="100" [value]="dustThreshold()" (input)="dustThreshold.set(dustInput.value)" />
        </label>
      </header>

      @if (loading()) { <p role="status">Reading UTXO pages…</p> }
      @for (warning of warnings(); track $index) { <p role="note">{{ warning }}</p> }
      @for (read of reads(); track read.key) { <p>{{ read.scope }}: {{ read.status }}</p> }
      @if (utxos().length === 0) {
        <p class="soft" i18n="@@universe.portfolio.utxo.empty">
          No UTXO rows are available in this read. Account coverage and read failures are shown above.
        </p>
      } @else {
        <div class="table-wrap">
          <table>
            <caption class="visually-hidden" i18n="@@universe.portfolio.utxo.caption">
              Unspent outputs with safety classes and effective values
            </caption>
            <thead>
              <tr>
                <th scope="col" i18n="@@universe.portfolio.utxo.outpoint">Outpoint</th>
                <th scope="col" class="num" i18n="@@universe.portfolio.utxo.value">Value (sats)</th>
                <th scope="col" class="num" i18n="@@universe.portfolio.utxo.confirmations">Confirmations</th>
                <th scope="col" class="num" i18n="@@universe.portfolio.utxo.effective">Effective @ fee</th>
                <th scope="col" i18n="@@universe.portfolio.utxo.safety">Safety</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.outpoint) {
                <tr>
                  <td class="mono">
                    {{ session.valuesHidden() ? masked() : row.outpointShort }}
                    <app-portfolio-data-state [state]="row.state" />
                  </td>
                  <td class="num">{{ session.valuesHidden() ? masked() : row.value }}</td>
                  <td class="num">{{ row.confirmations }}</td>
                  <td class="num">{{ session.valuesHidden() ? masked() : row.effective }}</td>
                  <td>{{ row.safety }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <section class="note" aria-label="Local protection">
          <h2 i18n="@@universe.portfolio.utxo.protection-title">Local protection flags</h2>
          <p class="soft" i18n="@@universe.portfolio.utxo.protection-copy">
            This read-only table does not set wallet locks or protection flags. Asset coverage and fee estimates do not authorize spending an output.
          </p>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .utxo { display: flex; flex-direction: column; gap: 14px; }
      .toolbar { display: flex; gap: 16px; flex-wrap: wrap; }
      label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--u-fg-soft, inherit); }
      input { min-height: 40px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--u-separator, rgba(0,0,0,0.14)); width: 130px; font: inherit; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
      th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--u-separator, rgba(0,0,0,0.06)); }
      th { font-size: 11.5px; text-transform: uppercase; color: var(--u-fg-soft, inherit); }
      .num { text-align: right; }
      .mono { font-family: monospace; font-size: 12.5px; }
      .note { border: 1px dashed var(--u-separator, rgba(0,0,0,0.16)); border-radius: 10px; padding: 12px 14px; }
      h2 { margin: 0 0 6px; font-size: 13px; }
      .soft { font-size: 12.5px; color: var(--u-fg-soft, inherit); margin: 0; }
      .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    `,
  ],
})
export class UtxoCenterComponent {
  readonly store = inject(PortfoliosStore);
  readonly session = inject(PortfolioSessionService);
  private readonly api = inject(PortfolioV2ApiService);
  readonly portfolioId = input<string>('');

  readonly feeRate = signal('10');
  readonly dustThreshold = signal('1000');
  private readonly utxoSignal = signal<readonly PortfolioUtxo[]>([]);
  readonly utxos = this.utxoSignal.asReadonly();
  readonly loading = signal(false);
  readonly warnings = signal<readonly string[]>([]);
  readonly reads = signal<readonly { key: string; scope: string; status: string }[]>([]);

  constructor() {
    effect(cleanup => {
      const scope = accountReadScope(this.store.activePortfolio());
      this.utxoSignal.set([]);
      this.warnings.set(scope.warnings);
      this.reads.set(scope.targets.map(t => ({ key: t.key, scope: `${t.accounts.join(', ')} · ${t.chain}/${t.network} · ${t.address}`, status: 'Pending' })));
      this.loading.set(scope.targets.length > 0);
      const all = new Map<string, PortfolioUtxo>();
      const sub = from(scope.targets).pipe(concatMap(target => all.size >= 10000 ? of({ target, utxos: [], status: 'Not requested: total inventory read limit', warnings: ['Inventory limit reached; account coverage is partial.'] }) : readUtxoPages(this.api, target))).subscribe({
        next: result => {
          this.reads.update(rows => rows.map(row => row.key === result.target.key ? { ...row, status: result.status } : row));
          this.warnings.update(rows => [...rows, ...result.warnings.map(warning => `${result.target.accounts.join(', ')}: ${warning}`)]);
          for (const utxo of result.utxos) {
            const key = `${utxo.chain}:${utxo.network}:${utxo.txid.toLowerCase()}:${utxo.vout}`;
            const prior = all.get(key);
            if (!prior && all.size < 10000) all.set(key, utxo);
            else if (!prior) this.warnings.update(rows => rows.includes('Inventory limit reached; additional outputs omitted.') ? rows : [...rows, 'Inventory limit reached; additional outputs omitted.']);
            else if (JSON.stringify(prior) !== JSON.stringify(utxo)) this.warnings.update(rows => [...rows, 'Conflicting duplicate outpoint across accounts; first observation retained. Coverage is partial.']);
          }
          this.utxoSignal.set([...all.values()]);
        },
        complete: () => this.loading.set(false),
      });
      cleanup(() => sub.unsubscribe());
    });
  }

  readonly rows = computed(() => {
    const fee = this.feeRate();
    const dust = this.dustThreshold();
    return this.utxos().map((utxo) => {
      const classification = classifyUtxo(utxo, { dustThresholdAtomic: /^\d{1,16}$/.test(dust) ? dust : undefined });
      const economics = /^\d{1,7}(\.\d{1,3})?$/.test(fee) && Number(fee) > 0 ? effectiveValue(utxo.valueAtomic, utxo.scriptType, fee) : null;
      const effective =
        economics === null
          ? '-'
          : economics.economic
            ? `${formatExact(economics.effectiveValueAtomic, 'en')} sats`
            : $localize`:@@universe.portfolio.utxo.uneconomic:Uneconomic to spend`;
      return {
        outpoint: `${utxo.chain}:${utxo.network}:${utxo.txid}:${utxo.vout}`,
        outpointShort: `${truncateIdentifier(utxo.txid, 10, 6)}:${utxo.vout}`,
        value: utxo.valueAtomic,
        confirmations: utxo.confirmationsAtomic,
        effective,
        safety: safetyLabel(classification.primary),
        state: utxo.assetState,
      };
    });
  });

  protected masked(): string {
    return maskedValue();
  }
}

function safetyLabel(primary: UtxoSafetyClass): string {
  const labels: Record<UtxoSafetyClass, string> = {
    'asset-bearing': $localize`:@@universe.portfolio.utxo.class.asset-bearing:Asset-bearing`,
    'plain-proven': $localize`:@@universe.portfolio.utxo.class.plain:Plain BTC, proven`,
    'plain-partial': $localize`:@@universe.portfolio.utxo.class.partial:Plain BTC, partial coverage`,
    'unknown-asset-state': $localize`:@@universe.portfolio.utxo.class.unknown:Unknown asset state`,
    'economic-dust': $localize`:@@universe.portfolio.utxo.class.dust:Economic dust`,
    'low-effective-value': $localize`:@@universe.portfolio.utxo.class.low:Low effective value`,
    pending: $localize`:@@universe.portfolio.utxo.class.pending:Pending`,
    'immature-coinbase': $localize`:@@universe.portfolio.utxo.class.immature:Immature coinbase`,
    'time-locked': $localize`:@@universe.portfolio.utxo.class.locked:Time-locked`,
    spent: $localize`:@@universe.portfolio.utxo.class.spent:Spent`,
    reorged: $localize`:@@universe.portfolio.utxo.class.reorged:Reorged`,
  };
  return labels[primary];
}
