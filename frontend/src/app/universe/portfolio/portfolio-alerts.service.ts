import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';
import {
  AlertRule,
  DEFAULT_ALERT_RULE,
  PortfolioAlert,
  decideAlerts,
} from '@app/universe/portfolio/portfolio-alerts';
import { PortfolioSummary } from '@app/universe/portfolio/portfolio.types';
import { watchKey } from '@app/universe/portfolio/portfolio-watchlist.service';

/**
 * Raises alerts for watched addresses and remembers which it has raised.
 *
 * Everything is local: the rule, the last snapshot, and the record of
 * what has already been announced. Nothing is sent anywhere, and there
 * is no server-side subscription, so watching an address leaves no trace
 * outside this browser.
 *
 * Browser notifications are only ever requested in response to the
 * visitor turning them on. A page that asks on load gets refused by the
 * browser and, more to the point, deserves to be.
 */

const RULE_KEY = 'universe.portfolio.alert-rule.v1';
const SEEN_KEY = 'universe.portfolio.alerts-seen.v1';
const SNAPSHOT_KEY = 'universe.portfolio.alert-baseline.v1';
/** How many raised alert ids to remember, so one is never repeated. */
const MAXIMUM_SEEN = 500;
const MAXIMUM_ALERTS_HELD = 100;

const ALERT_KINDS = new Set([
  'asset-received',
  'asset-sent',
  'quantity-changed',
  'source-degraded',
]);

@Injectable({ providedIn: 'root' })
export class PortfolioAlertsService {
  private readonly alertSubject = new BehaviorSubject<readonly PortfolioAlert[]>([]);
  readonly alerts$: Observable<readonly PortfolioAlert[]> = this.alertSubject.asObservable();

  private rule: AlertRule = DEFAULT_ALERT_RULE;
  private seen = new Set<string>();

  constructor(private stateService: StateService) {
    if (this.available()) {
      this.rule = this.readRule();
      this.seen = new Set(this.readSeen());
    }
  }

  private available(): boolean {
    return !!this.stateService?.isBrowser;
  }

  private read(key: string): unknown {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // A blocked or full store costs the visitor their alert history,
      // not the page.
    }
  }

  private readRule(): AlertRule {
    const parsed = this.read(RULE_KEY);
    if (typeof parsed !== 'object' || parsed === null) { return DEFAULT_ALERT_RULE; }
    const record = parsed as Record<string, unknown>;
    const kinds = Array.isArray(record.kinds)
      ? record.kinds.filter(
          (kind): kind is AlertRule['kinds'][number] =>
            typeof kind === 'string' && ALERT_KINDS.has(kind),
        )
      : DEFAULT_ALERT_RULE.kinds;
    const ratio =
      typeof record.minimumChangeRatio === 'string'
        && /^$|^0(\.\d{1,6})?$|^1(\.0+)?$/.test(record.minimumChangeRatio)
        ? record.minimumChangeRatio
        : '';
    return { kinds, minimumChangeRatio: ratio };
  }

  private readSeen(): string[] {
    const parsed = this.read(SEEN_KEY);
    if (!Array.isArray(parsed)) { return []; }
    return parsed
      .filter((id): id is string => typeof id === 'string' && id.length <= 256)
      .slice(0, MAXIMUM_SEEN);
  }

  currentRule(): AlertRule {
    return this.rule;
  }

  setRule(rule: AlertRule): void {
    this.rule = {
      kinds: rule.kinds.filter((kind) => ALERT_KINDS.has(kind)),
      minimumChangeRatio: rule.minimumChangeRatio,
    };
    if (this.available()) { this.write(RULE_KEY, this.rule); }
  }

  /** True when the browser will show notifications for this origin. */
  notificationsGranted(): boolean {
    if (!this.available() || typeof Notification === 'undefined') { return false; }
    return Notification.permission === 'granted';
  }

  /**
   * Asks the browser for notification permission. Only ever called from
   * a visitor action, never on load.
   */
  async requestNotifications(): Promise<boolean> {
    if (!this.available() || typeof Notification === 'undefined') { return false; }
    try {
      const result = await Notification.requestPermission();
      return result === 'granted';
    } catch {
      return false;
    }
  }

  private baselineKey(chain: string, network: string, address: string): string {
    return `${SNAPSHOT_KEY}:${watchKey({ chain, network, address })}`;
  }

  /**
   * Compares a fresh summary against the last one seen for this address
   * and returns the alerts worth raising, having recorded them so they
   * are raised exactly once.
   */
  evaluate(
    chain: string,
    network: string,
    address: string,
    summary: PortfolioSummary,
  ): readonly PortfolioAlert[] {
    if (!this.available()) { return []; }
    const key = this.baselineKey(chain, network, address);
    const previous = this.read(key) as PortfolioSummary | null;
    // The baseline is stored before anything is raised, so a failure
    // partway through cannot make the next visit replay the same change.
    this.write(key, summary);

    const decided = decideAlerts(previous, summary, this.rule);
    const fresh = decided.filter((alert) => !this.seen.has(alert.id));
    if (fresh.length === 0) { return []; }

    for (const alert of fresh) { this.seen.add(alert.id); }
    const trimmed = [...this.seen].slice(-MAXIMUM_SEEN);
    this.seen = new Set(trimmed);
    this.write(SEEN_KEY, trimmed);

    const held = [...fresh, ...this.alertSubject.value].slice(0, MAXIMUM_ALERTS_HELD);
    this.alertSubject.next(held);
    this.notify(fresh);
    return fresh;
  }

  private notify(alerts: readonly PortfolioAlert[]): void {
    if (!this.notificationsGranted()) { return; }
    // One notification per batch. A separate one per asset turns a
    // single transaction into a burst nobody reads.
    const first = alerts[0];
    const body =
      alerts.length === 1
        ? first.detail
        : `${first.detail} and ${alerts.length - 1} more changes`;
    try {
      new Notification(first.title, { body, tag: first.id });
    } catch {
      // Notification construction can throw in some embedded contexts;
      // the in-page list already carries the same alerts.
    }
  }

  dismissAll(): void {
    this.alertSubject.next([]);
  }
}
