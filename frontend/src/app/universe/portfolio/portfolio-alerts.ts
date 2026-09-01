/**
 * Alert rules for watched addresses, and the decision of what to raise.
 *
 * The rules live in this browser alongside the watchlist and are never
 * sent anywhere. What matters here is the decision itself, so it is a
 * pure function of two portfolio snapshots and a rule: given what an
 * address looked like before and what it looks like now, which of the
 * things the visitor asked to be told about actually happened.
 *
 * The hard part is not detecting change. It is refusing to report change
 * that is really a source going quiet. An asset that vanishes because
 * its authority stopped answering has not been sent anywhere, and saying
 * it has would be worse than saying nothing.
 */

import {
  PortfolioHolding,
  PortfolioSummary,
} from '@app/universe/portfolio/portfolio.types';

export type AlertKind =
  | 'asset-received'
  | 'asset-sent'
  | 'quantity-changed'
  | 'source-degraded';

export interface AlertRule {
  /** Which kinds of change this visitor wants to hear about. */
  readonly kinds: readonly AlertKind[];
  /**
   * Ignore quantity changes smaller than this share of the prior
   * quantity, as an exact decimal string between 0 and 1. An empty
   * string means report every change.
   */
  readonly minimumChangeRatio: string;
}

export const DEFAULT_ALERT_RULE: AlertRule = {
  kinds: ['asset-received', 'asset-sent', 'quantity-changed', 'source-degraded'],
  minimumChangeRatio: '',
};

export interface PortfolioAlert {
  readonly kind: AlertKind;
  /** Stable identity, so the same event is never raised twice. */
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly assetKey?: string;
  readonly protocol?: string;
}

/** The states in which a protocol statement is worth alerting about. */
const DEGRADED_STATES = new Set(['unavailable', 'partial', 'stale']);

function holdingsByKey(
  summary: PortfolioSummary,
): Map<string, PortfolioHolding> {
  const byKey = new Map<string, PortfolioHolding>();
  if (summary.nativeBalance) {
    byKey.set(summary.nativeBalance.assetKey, summary.nativeBalance);
  }
  for (const statement of summary.protocols) {
    // Only a statement that actually answered contributes holdings. A
    // source that failed contributes nothing, so its assets neither
    // appear nor disappear.
    if (statement.state !== 'proven' && statement.state !== 'partial') {
      continue;
    }
    for (const holding of statement.holdings) {
      byKey.set(holding.assetKey, holding);
    }
  }
  return byKey;
}

/** Protocols whose source answered in full, by protocol id. */
function answeredProtocols(summary: PortfolioSummary): Set<string> {
  const answered = new Set<string>();
  for (const statement of summary.protocols) {
    if (statement.state === 'proven' || statement.state === 'partial') {
      answered.add(statement.protocol);
    }
  }
  return answered;
}

/** Compares two exact non-negative decimal strings. */
function compareDecimal(a: string, b: string): number {
  const normalise = (value: string): [string, string] => {
    const [whole, fraction = ''] = value.split('.');
    return [whole.replace(/^0+(?=\d)/, ''), fraction];
  };
  const [wholeA, fractionA] = normalise(a);
  const [wholeB, fractionB] = normalise(b);
  if (wholeA.length !== wholeB.length) {
    return wholeA.length < wholeB.length ? -1 : 1;
  }
  if (wholeA !== wholeB) { return wholeA < wholeB ? -1 : 1; }
  const width = Math.max(fractionA.length, fractionB.length);
  const paddedA = fractionA.padEnd(width, '0');
  const paddedB = fractionB.padEnd(width, '0');
  if (paddedA === paddedB) { return 0; }
  return paddedA < paddedB ? -1 : 1;
}

/**
 * True when the change from `before` to `after` clears the rule's
 * threshold. Exact integer arithmetic: |after - before| * 1 >= before * ratio.
 */
function clearsThreshold(
  before: string,
  after: string,
  minimumChangeRatio: string,
): boolean {
  if (!minimumChangeRatio) { return true; }
  if (!/^(0|[1-9][0-9]*)$/.test(before) || !/^(0|[1-9][0-9]*)$/.test(after)) {
    return true;
  }
  if (!/^0(\.\d+)?$|^1(\.0+)?$/.test(minimumChangeRatio)) { return true; }
  const priorAmount = BigInt(before);
  if (priorAmount === 0n) { return true; }
  const currentAmount = BigInt(after);
  const delta =
    currentAmount > priorAmount
      ? currentAmount - priorAmount
      : priorAmount - currentAmount;
  const [whole, fraction = ''] = minimumChangeRatio.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const ratio = BigInt(whole + fraction);
  return delta * scale >= priorAmount * ratio;
}

function displayName(holding: PortfolioHolding): string {
  return (
    holding.displayName ??
    holding.ticker ??
    holding.identity.assetId.slice(0, 24)
  );
}

/**
 * The alerts to raise for one address, given the previous snapshot and
 * the current one. A null `previous` raises nothing: the first sight of
 * an address is not news, it is the baseline.
 */
export function decideAlerts(
  previous: PortfolioSummary | null,
  current: PortfolioSummary,
  rule: AlertRule = DEFAULT_ALERT_RULE,
): PortfolioAlert[] {
  if (previous === null) { return []; }
  const wanted = new Set(rule.kinds);
  const alerts: PortfolioAlert[] = [];
  const snapshot = current.envelope.snapshotId;

  const before = holdingsByKey(previous);
  const after = holdingsByKey(current);
  const answeredBefore = answeredProtocols(previous);
  const answeredNow = answeredProtocols(current);

  for (const [key, holding] of after) {
    const prior = before.get(key);
    if (prior === undefined) {
      // New to us only if its protocol was answering before as well.
      // Otherwise it may have been there all along, unseen.
      if (!answeredBefore.has(holding.identity.protocol)) { continue; }
      if (!wanted.has('asset-received')) { continue; }
      alerts.push({
        kind: 'asset-received',
        id: `${snapshot}:received:${key}`,
        title: `New holding: ${displayName(holding)}`,
        detail: `${holding.identity.protocol} on ${holding.identity.chain}`,
        assetKey: key,
        protocol: holding.identity.protocol,
      });
      continue;
    }
    if (!wanted.has('quantity-changed')) { continue; }
    const priorQuantity = prior.quantityAtomic;
    const currentQuantity = holding.quantityAtomic;
    if (priorQuantity === null || currentQuantity === null) { continue; }
    if (priorQuantity === currentQuantity) { continue; }
    if (!clearsThreshold(priorQuantity, currentQuantity, rule.minimumChangeRatio)) {
      continue;
    }
    const rose = compareDecimal(currentQuantity, priorQuantity) > 0;
    alerts.push({
      kind: 'quantity-changed',
      id: `${snapshot}:quantity:${key}`,
      title: `${displayName(holding)} ${rose ? 'increased' : 'decreased'}`,
      detail: `${priorQuantity} to ${currentQuantity}`,
      assetKey: key,
      protocol: holding.identity.protocol,
    });
  }

  if (wanted.has('asset-sent')) {
    for (const [key, holding] of before) {
      if (after.has(key)) { continue; }
      // The decisive guard. An asset missing from a protocol that has
      // stopped answering has not left the address; we simply cannot
      // see it. Reporting that as a departure would be a lie.
      if (!answeredNow.has(holding.identity.protocol)) { continue; }
      alerts.push({
        kind: 'asset-sent',
        id: `${snapshot}:sent:${key}`,
        title: `No longer held: ${displayName(holding)}`,
        detail: `${holding.identity.protocol} on ${holding.identity.chain}`,
        assetKey: key,
        protocol: holding.identity.protocol,
      });
    }
  }

  if (wanted.has('source-degraded')) {
    const priorStates = new Map(
      previous.protocols.map((statement) => [statement.protocol, statement.state]),
    );
    for (const statement of current.protocols) {
      const was = priorStates.get(statement.protocol);
      if (was === undefined) { continue; }
      if (DEGRADED_STATES.has(statement.state) && !DEGRADED_STATES.has(was)) {
        alerts.push({
          kind: 'source-degraded',
          id: `${snapshot}:degraded:${statement.protocol}`,
          title: `${statement.protocol} stopped answering in full`,
          detail: statement.warnings[0] ?? `The source is now ${statement.state}.`,
          protocol: statement.protocol,
        });
      }
    }
  }

  return alerts;
}
