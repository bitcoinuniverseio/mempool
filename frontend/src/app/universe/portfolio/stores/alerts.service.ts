/**
 * The alert extension: local, vault-encrypted alert rules evaluated
 * against refresh results and live WebSocket address events. This
 * extends the existing watchlist/alerting pattern rather than building a
 * second alert product. Live subscriptions disclose that watched public
 * addresses are visible to the first-party service; the xpub, labels,
 * groups, and portfolio names never are.
 */

import { Injectable, inject, signal } from '@angular/core';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from './portfolios.store';
import type { AlertRule, AlertRuleKind } from './portfolio-model';
import { newLocalId } from './portfolio-model';
import type {
  PortfolioSemanticEvent,
} from '@app/shared/universe-portfolio-v2.types';

export interface FiredAlert {
  readonly ruleId: string;
  readonly kind: AlertRuleKind;
  readonly title: string;
  readonly at: string;
}

@Injectable({ providedIn: 'root' })
export class PortfolioAlertsService {
  private readonly store = inject(PortfoliosStore);
  private readonly api = inject(PortfolioV2ApiService);
  private readonly firedSignal = signal<FiredAlert[]>([]);
  readonly fired = this.firedSignal.asReadonly();

  /** Adds a rule to the active portfolio and persists it in the vault. */
  async addRule(kind: AlertRuleKind, options: Partial<AlertRule> = {}): Promise<void> {
    const portfolio = this.store.activePortfolio();
    if (portfolio === null) return;
    const rule: AlertRule = {
      id: newLocalId(),
      kind,
      enabled: true,
      createdAt: new Date().toISOString(),
      snoozedUntil: null,
      lastFiredAt: null,
      ...options,
    };
    await this.store.updatePortfolio(portfolio.id, (current) => ({
      ...current,
      alertRules: [...current.alertRules, rule],
    }));
  }

  /** Removes one rule. */
  async removeRule(ruleId: string): Promise<void> {
    const portfolio = this.store.activePortfolio();
    if (portfolio === null) return;
    await this.store.updatePortfolio(portfolio.id, (current) => ({
      ...current,
      alertRules: current.alertRules.filter((rule) => rule.id !== ruleId),
    }));
  }

  /**
   * Evaluates one live semantic event against the enabled rules of the
   * active portfolio. Deduplication: a (ruleId, txid) pair never fires
   * twice in one session; every alert is reconciled against the next
   * authoritative refresh.
   */
  evaluateEvent(event: PortfolioSemanticEvent, accountId: string): FiredAlert | null {
    const portfolio = this.store.activePortfolio();
    if (portfolio === null) return null;
    for (const rule of portfolio.alertRules) {
      if (!rule.enabled) continue;
      const snoozed = rule.snoozedUntil !== null && rule.snoozedUntil !== undefined && rule.snoozedUntil > new Date().toISOString();
      if (snoozed) continue;
      const matches = ruleMatches(rule, event, accountId);
      if (!matches) continue;
      const dedupeKey = `${rule.id}:${event.txid}`;
      if (this.firedSignal().some((alert) => alert.ruleId === dedupeKey)) continue;
      const fired: FiredAlert = {
        ruleId: dedupeKey,
        kind: rule.kind,
        title: describeAlert(rule.kind, event),
        at: new Date().toISOString(),
      };
      this.firedSignal.update((current) => [fired, ...current].slice(0, 50));
      return fired;
    }
    return null;
  }

  clear(): void {
    this.firedSignal.set([]);
  }
}

function ruleMatches(rule: AlertRule, event: PortfolioSemanticEvent, accountId: string): boolean {
  switch (rule.kind) {
    case 'incoming-asset':
      return event.direction === 'in' && event.confirmationState !== 'unknown';
    case 'outgoing-asset':
      return event.direction === 'out' && event.confirmationState !== 'unknown';
    case 'internal-transfer':
      return event.eventType === 'internal-transfer';
    case 'confirmation':
      return event.confirmationState === 'confirmed';
    case 'reorg':
      return event.confirmationState === 'reorged';
    case 'replacement':
      return event.confirmationState === 'replaced';
    case 'value-threshold': {
      if (rule.thresholdAtomic === undefined || event.nativeValueAtomic === null) return false;
      return BigInt(event.nativeValueAtomic.replace(/-.*/, '')) >= BigInt(rule.thresholdAtomic);
    }
    case 'source-degraded':
    case 'source-recovered':
    case 'utxo-dust':
    case 'utxo-asset-bearing':
    case 'quantity-change':
    case 'price-stale':
    case 'asset-unpriced':
    case 'snapshot-completed':
    case 'discovery-new-address':
      // These evaluate during refresh and discovery flows, not per event.
      return false;
    default:
      return false;
  }
}

function describeAlert(kind: AlertRuleKind, event: PortfolioSemanticEvent): string {
  switch (kind) {
    case 'incoming-asset':
      return $localize`:@@universe.portfolio.alerts.incoming:An incoming transfer was seen on a tracked address.`;
    case 'outgoing-asset':
      return $localize`:@@universe.portfolio.alerts.outgoing:An outgoing transfer was seen on a tracked address.`;
    case 'internal-transfer':
      return $localize`:@@universe.portfolio.alerts.internal:An internal transfer between tracked accounts was confirmed.`;
    case 'confirmation':
      return $localize`:@@universe.portfolio.alerts.confirmed:A pending movement confirmed.`;
    default:
      return $localize`:@@universe.portfolio.alerts.generic:A tracked portfolio event fired an alert rule.`;
  }
}
