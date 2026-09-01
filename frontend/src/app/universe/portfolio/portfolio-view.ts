/**
 * Pure view-model logic for the portfolio page.
 *
 * Continuation pages are merged by asset identity with exact BigInt
 * arithmetic, states are folded pessimistically (a worse claim always
 * survives a better one), and every label a person reads comes from here so
 * the page cannot improvise a misleading zero.
 */

import {
  PortfolioHolding,
  PortfolioProtocolStatement,
  PortfolioSourceState,
  PortfolioSummary,
} from '@app/universe/portfolio/portfolio.types';

const ATOMIC = /^(0|[1-9][0-9]*)$/;

/** Worst-first order for folding two source states into one claim. */
const STATE_SEVERITY: readonly PortfolioSourceState[] = [
  'unavailable',
  'stale',
  'partial',
  'pending',
  'outside_coverage',
  'unsupported',
  'proven',
];

export function worseState(
  a: PortfolioSourceState,
  b: PortfolioSourceState,
): PortfolioSourceState {
  return STATE_SEVERITY.indexOf(a) <= STATE_SEVERITY.indexOf(b) ? a : b;
}

/**
 * Merges a continuation page into the accumulated summary. Holdings met
 * again on a later page (an asset spread over more unspent outputs than one
 * page covers) are folded by asset key: quantities are summed exactly when
 * both pages state one, custody references are concatenated, and a missing
 * quantity on either side makes the merged quantity null rather than a
 * partial sum presented as a whole.
 */
export function mergeSummaries(
  base: PortfolioSummary,
  next: PortfolioSummary,
): PortfolioSummary {
  const byProtocol = new Map<string, PortfolioProtocolStatement>();
  for (const statement of base.protocols) {
    byProtocol.set(statement.protocol, statement);
  }
  const merged: PortfolioProtocolStatement[] = [];
  for (const statement of next.protocols) {
    const previous = byProtocol.get(statement.protocol);
    if (!previous) {
      merged.push(statement);
      continue;
    }
    merged.push({
      ...statement,
      state: worseState(previous.state, statement.state),
      holdings: mergeHoldings(previous.holdings, statement.holdings),
      warnings: dedupe([...previous.warnings, ...statement.warnings]),
    });
    byProtocol.delete(statement.protocol);
  }
  // A protocol present earlier but absent from the continuation keeps its
  // accumulated statement rather than silently vanishing.
  for (const statement of base.protocols) {
    if (byProtocol.has(statement.protocol)) {
      merged.push(statement);
    }
  }
  const holdings = allHoldings({ ...next, protocols: merged });
  return {
    ...next,
    protocols: merged,
    nativeBalance: next.nativeBalance ?? base.nativeBalance,
    totalHoldingCount: holdings.length,
    protocolCount: merged.filter((statement) => statement.holdings.length > 0).length,
  };
}

function mergeHoldings(
  previous: readonly PortfolioHolding[],
  next: readonly PortfolioHolding[],
): PortfolioHolding[] {
  const byKey = new Map<string, PortfolioHolding>();
  for (const holding of previous) {
    byKey.set(holding.assetKey, holding);
  }
  for (const holding of next) {
    const existing = byKey.get(holding.assetKey);
    if (!existing) {
      byKey.set(holding.assetKey, holding);
      continue;
    }
    const bothCounted =
      existing.quantityAtomic !== null
      && holding.quantityAtomic !== null
      && ATOMIC.test(existing.quantityAtomic)
      && ATOMIC.test(holding.quantityAtomic);
    byKey.set(holding.assetKey, {
      ...existing,
      quantityAtomic: bothCounted
        ? (BigInt(existing.quantityAtomic) + BigInt(holding.quantityAtomic)).toString()
        : null,
      custody: [...existing.custody, ...holding.custody],
      warnings: dedupe([...existing.warnings, ...holding.warnings]),
    });
  }
  return [...byKey.values()];
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Every holding in the summary, the native balance included. */
export function allHoldings(summary: PortfolioSummary): PortfolioHolding[] {
  const holdings: PortfolioHolding[] = [];
  if (summary.nativeBalance) {
    holdings.push(summary.nativeBalance);
  }
  for (const statement of summary.protocols) {
    holdings.push(...statement.holdings);
  }
  return holdings;
}

/** Deterministic display order: protocol, then quantity descending, then id. */
export function sortHoldings(
  holdings: readonly PortfolioHolding[],
): PortfolioHolding[] {
  return [...holdings].sort((a, b) => {
    if (a.identity.assetType === 'native' && b.identity.assetType !== 'native') { return -1; }
    if (b.identity.assetType === 'native' && a.identity.assetType !== 'native') { return 1; }
    const protocol = a.identity.protocol.localeCompare(b.identity.protocol);
    if (protocol !== 0) { return protocol; }
    const aQuantity = a.quantityAtomic !== null && ATOMIC.test(a.quantityAtomic) ? BigInt(a.quantityAtomic) : -1n;
    const bQuantity = b.quantityAtomic !== null && ATOMIC.test(b.quantityAtomic) ? BigInt(b.quantityAtomic) : -1n;
    if (aQuantity !== bQuantity) { return aQuantity > bQuantity ? -1 : 1; }
    return a.assetKey.localeCompare(b.assetKey);
  });
}

export const TOKEN_ASSET_TYPES: readonly string[] = ['native', 'fungible'];
export const COLLECTIBLE_ASSET_TYPES: readonly string[] = [
  'nft', 'inscription', 'rare_sat', 'name', 'realm', 'subrealm', 'bitmap',
];

/**
 * The truthful sentence for one source state. These are the §23 phrasings:
 * no developer vocabulary, no ambiguous zeroes.
 */
export function sourceStateCopy(state: PortfolioSourceState): string {
  switch (state) {
    case 'proven':
      return $localize`:@@universe.portfolio.state-proven:Answered in full`;
    case 'partial':
      return $localize`:@@universe.portfolio.state-partial:Answered in part, so this list may be incomplete`;
    case 'outside_coverage':
      return $localize`:@@universe.portfolio.state-outside:Outside what this source can see`;
    case 'pending':
      return $localize`:@@universe.portfolio.state-pending:Awaiting confirmation`;
    case 'stale':
      return $localize`:@@universe.portfolio.state-stale:Older than its freshness budget`;
    case 'unavailable':
      return $localize`:@@universe.portfolio.state-unavailable:This source did not answer, so the portfolio may be incomplete`;
    case 'unsupported':
      return $localize`:@@universe.portfolio.state-unsupported:Not served by any configured source yet`;
  }
}

/** Whether a statement's empty holdings list is a proven fact or a hole. */
export function emptyMeansEmpty(state: PortfolioSourceState): boolean {
  return state === 'proven';
}
