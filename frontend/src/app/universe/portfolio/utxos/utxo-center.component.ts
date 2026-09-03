/**
 * The UTXO center: read-only inventory, safety classification, effective
 * value economics at a user-selected fee rate, and consolidation analysis.
 * Nothing here signs, selects coins, or represents a local flag as an
 * on-chain lock.
 */

import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
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

      @if (utxos().length === 0) {
        <p class="soft" i18n="@@universe.portfolio.utxo.empty">
          No UTXO composition is available for the current accounts yet. UTXO intelligence
          serves Bitcoin mainnet addresses with outputs.
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
            A protect flag is a local note in your encrypted vault. It is never presented as a
            wallet lock or an on-chain condition, and it warns you if another Universe tool
            tries to involve the output.
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
export class UtxoCenterComponent implements OnInit {
  readonly store = inject(PortfoliosStore);
  readonly session = inject(PortfolioSessionService);
  private readonly api = inject(PortfolioV2ApiService);
  readonly portfolioId = input<string>('');

  readonly feeRate = signal('10');
  readonly dustThreshold = signal('1000');
  private readonly utxoSignal = signal<readonly PortfolioUtxo[]>([]);
  readonly utxos = this.utxoSignal.asReadonly();
  private loaded = false;

  ngOnInit(): void {
    if (this.loaded) return;
    this.loaded = true;
    void this.load();
  }

  private async load(): Promise<void> {
    const portfolio = this.store.activePortfolio();
    if (portfolio === null) return;
    const collected: PortfolioUtxo[] = [];
    for (const account of portfolio.accounts) {
      for (const address of account.addresses ?? []) {
        try {
          const page = await firstValueFrom(
            this.api.getUtxos$(account.chain, account.network, address, undefined, 50),
          );
          collected.push(...page.utxos);
        } catch {
          // A failed account stays out of the inventory; the summary
          // surfaces the failure rather than a fake empty set.
        }
      }
    }
    this.utxoSignal.set(collected);
  }

  readonly rows = computed(() => {
    const fee = this.feeRate();
    const dust = this.dustThreshold();
    return this.utxos().map((utxo) => {
      const classification = classifyUtxo(utxo, { dustThresholdAtomic: /^\d+$/.test(dust) ? dust : undefined });
      const economics = effectiveValue(utxo.valueAtomic, utxo.scriptType, /^\d+(\.\d+)?$/.test(fee) ? fee : '10');
      const effective =
        economics === null
          ? '-'
          : economics.economic
            ? `${formatExact(economics.effectiveValueAtomic, 'en')} sats`
            : $localize`:@@universe.portfolio.utxo.uneconomic:Uneconomic to spend`;
      return {
        outpoint: `${utxo.txid}:${utxo.vout}`,
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
