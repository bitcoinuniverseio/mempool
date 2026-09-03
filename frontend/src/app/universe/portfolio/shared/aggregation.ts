/**
 * The client-side portfolio aggregation engine.
 *
 * One deterministic engine every Portfolio Intelligence surface uses. It
 * merges per-address v2 snapshots into a portfolio-wide view:
 *
 * - one address counted once, with an explicit inclusion policy when the
 *   same address sits under several accounts;
 * - the same protocol asset merged across accounts by its asset key,
 *   quantities summed with exact BigInt arithmetic;
 * - every chain and network structurally separate; values never summed
 *   across quote currencies;
 * - source state folded pessimistically, every contributing report kept;
 * - unresolved quantities and values in explicit unknown buckets;
 * - internal transfers detected from transaction evidence and reported as
 *   movement, never as economic inflow or outflow.
 *
 * The same inputs always produce the same output: no wall-clock, no
 * iteration-order dependence, no randomness.
 */

import { foldDataStates, type PortfolioDataState } from '@app/shared/universe-portfolio-v2.types';
import { sumExact } from './exact';

export interface AddressSnapshot {
  readonly chain: string;
  readonly network: string;
  readonly address: string;
  readonly accountId: string;
  readonly summary: {
    readonly aggregateState: PortfolioDataState;
    readonly valuation: {
      readonly quoteCurrency: string;
      readonly pricedValue: string;
      readonly pricedHoldingCount: number;
      readonly unpricedHoldingCount: number;
      readonly state: 'complete-priced' | 'partially-priced' | 'unpriced';
    };
    readonly sources: readonly {
      readonly authorityId: string;
      readonly state: PortfolioDataState;
    }[];
  };
  readonly holdings: {
    readonly assetKey: string;
    readonly displayName?: string;
    readonly ticker?: string;
    readonly decimals?: number;
    readonly quantityAtomic: string | null;
    readonly value?: string;
    readonly valuationState: 'priced' | 'unpriced' | 'stale-price' | 'not-applicable';
    readonly quoteCurrency?: string;
    readonly sourceState: PortfolioDataState;
    readonly protocol: string;
    readonly assetType: string;
    readonly accountId: string;
    readonly locations: readonly {
      readonly kind: 'outpoint' | 'protocol-ledger' | 'manual';
      readonly reference: string;
      readonly quantityAtomic: string | null;
      readonly address: string;
      readonly accountId: string;
    }[];
  };
}

export interface PortfolioEventInput {
  readonly chain: string;
  readonly network: string;
  readonly txid: string;
  readonly eventType: string;
  readonly direction: 'in' | 'out' | 'internal' | 'neutral' | 'unknown';
  readonly confirmationState: string;
  readonly timestamp: string | null;
  readonly blockHeightAtomic: string | null;
  readonly nativeValueAtomic: string | null;
  readonly feeAtomic: string | null;
  readonly accountId: string;
  readonly address: string;
  readonly counterparties: readonly string[];
  readonly assetKeys: readonly string[];
  readonly sourceState: PortfolioDataState;
}

export interface AggregatedHolding {
  readonly assetKey: string;
  readonly chain: string;
  readonly network: string;
  readonly protocol: string;
  readonly assetType: string;
  readonly displayName?: string;
  readonly ticker?: string;
  readonly decimals?: number;
  readonly quantityAtomic: string | null;
  readonly pricedValue: string | null;
  readonly quoteCurrency: string | null;
  readonly valuationState: 'priced' | 'unpriced' | 'stale-price' | 'not-applicable';
  readonly state: PortfolioDataState;
  readonly accountIds: readonly string[];
  readonly locationCount: number;
  readonly locations: AddressSnapshot['holdings']['locations'];
}

export interface InternalTransferCandidate {
  readonly chain: string;
  readonly network: string;
  readonly txid: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly quantityAtomic: string;
  readonly feeAtomic: string | null;
  readonly timestamp: string | null;
}

export interface AggregationResult {
  readonly quoteCurrency: string;
  readonly pricedTotal: string | null;
  readonly unpricedCount: number;
  readonly state: PortfolioDataState;
  readonly holdings: readonly AggregatedHolding[];
  readonly byAccount: readonly {
    readonly accountId: string;
    readonly pricedValue: string | null;
    readonly state: PortfolioDataState;
    readonly holdingCount: number;
  }[];
  readonly externalInflowAtomic: string | null;
  readonly externalOutflowAtomic: string | null;
  readonly internalTransfers: readonly InternalTransferCandidate[];
  readonly unknownValueBucket: 'present' | 'absent';
  readonly duplicateAddresses: readonly string[];
}

const FEE_TOLERANCE = 0n;

/**
 * Merges per-address snapshots into the portfolio view. `inclusionPolicy`
 * maps address → the account that counts for it; addresses claimed by
 * multiple accounts without a policy entry are reported as duplicates and
 * counted exactly once, under their first account by name - never twice.
 */
export function aggregatePortfolio(
  snapshots: readonly AddressSnapshot[],
  events: readonly PortfolioEventInput[] = [],
  options: {
    readonly inclusionPolicy?: Readonly<Record<string, string>>;
    readonly includeAccounts?: readonly string[];
  } = {},
): AggregationResult {
  const policy = options.inclusionPolicy ?? {};
  const includeAccounts =
    options.includeAccounts === undefined
      ? null
      : new Set(options.includeAccounts);

  // One address counted once: pick the account the policy names, or the
  // lexicographically first account that claims it.
  const claimedBy = new Map<string, string>();
  const duplicates: string[] = [];
  for (const snapshot of snapshots) {
    if (includeAccounts !== null && !includeAccounts.has(snapshot.accountId)) continue;
    const existing = claimedBy.get(snapshot.address);
    if (existing === undefined) {
      claimedBy.set(snapshot.address, policy[snapshot.address] ?? snapshot.accountId);
    } else if (existing !== (policy[snapshot.address] ?? snapshot.accountId)) {
      if (!duplicates.includes(snapshot.address)) duplicates.push(snapshot.address);
    }
  }
  const included = snapshots.filter(
    (snapshot) =>
      claimedBy.get(snapshot.address) === snapshot.accountId &&
      (includeAccounts === null || includeAccounts.has(snapshot.accountId)),
  );
  duplicates.sort();

  // Holdings merge by protocol asset key, exact sums, locations retained.
  const byAsset = new Map<
    string,
    {
      quantities: (string | null)[];
      valuesByQuote: Map<string, string[]>;
      states: PortfolioDataState[];
      accountIds: Set<string>;
      locations: AddressSnapshot['holdings']['locations'][number][];
      meta: {
        chain: string; network: string; protocol: string; assetType: string;
        displayName?: string; ticker?: string; decimals?: number;
        valuationState: 'priced' | 'unpriced' | 'stale-price' | 'not-applicable';
      };
    }
  >();
  for (const snapshot of included) {
    for (const holding of [snapshot.holdings]) {
      const entry = byAsset.get(holding.assetKey) ?? {
        quantities: [],
        valuesByQuote: new Map<string, string[]>(),
        states: [],
        accountIds: new Set<string>(),
        locations: [] as AddressSnapshot['holdings']['locations'][number][],
        meta: {
          chain: snapshot.chain,
          network: snapshot.network,
          protocol: holding.protocol,
          assetType: holding.assetType,
          displayName: holding.displayName,
          ticker: holding.ticker,
          decimals: holding.decimals,
          valuationState: holding.valuationState,
        },
      };
      entry.quantities.push(holding.quantityAtomic);
      entry.states.push(holding.sourceState);
      entry.accountIds.add(holding.accountId);
      entry.locations.push(...holding.locations);
      const quote = holding.quoteCurrency ?? 'unpriced';
      const values = entry.valuesByQuote.get(quote) ?? [];
      if (holding.value !== undefined) values.push(holding.value);
      entry.valuesByQuote.set(quote, values);
      byAsset.set(holding.assetKey, entry);
    }
  }

  const quoteCurrency = pickQuoteCurrency(included);
  const holdings: AggregatedHolding[] = [];
  let unpricedCount = 0;
  for (const [assetKey, entry] of [...byAsset.entries()].sort(compareAssetKey)) {
    const quantity = sumExact(
      entry.quantities.map((value) => value ?? '0'),
    );
    const quantitiesKnown = entry.quantities.every((value) => value !== null);
    const values = entry.valuesByQuote.get(quoteCurrency) ?? [];
    const pricedValue = values.length > 0 ? sumExact(values) : null;
    if (
      entry.meta.valuationState !== 'priced' &&
      entry.meta.valuationState !== 'not-applicable'
    ) {
      unpricedCount += 1;
    }
    holdings.push({
      assetKey,
      chain: entry.meta.chain,
      network: entry.meta.network,
      protocol: entry.meta.protocol,
      assetType: entry.meta.assetType,
      displayName: entry.meta.displayName,
      ticker: entry.meta.ticker,
      decimals: entry.meta.decimals,
      quantityAtomic: quantitiesKnown ? quantity : null,
      pricedValue,
      quoteCurrency: pricedValue === null ? null : quoteCurrency,
      valuationState: entry.meta.valuationState,
      state: foldDataStates(entry.states),
      accountIds: [...entry.accountIds].sort(),
      locationCount: entry.locations.length,
      locations: entry.locations,
    });
  }

  const accountValues = new Map<string, { values: string[]; states: PortfolioDataState[]; count: number }>();
  for (const snapshot of included) {
    const entry = accountValues.get(snapshot.accountId) ?? { values: [], states: [], count: 0 };
    if (snapshot.summary.valuation.quoteCurrency === quoteCurrency) {
      entry.values.push(snapshot.summary.valuation.pricedValue);
    }
    entry.states.push(snapshot.summary.aggregateState);
    entry.count += 1;
    accountValues.set(snapshot.accountId, entry);
  }

  const pricedTotal = sumExact(
    holdings.map((holding) => holding.pricedValue ?? '0'),
  );
  const hasUnknownValue =
    holdings.some((holding) => holding.quantityAtomic === null) ||
    holdings.some((holding) => holding.pricedValue === null && holding.valuationState !== 'not-applicable') ||
    included.some((snapshot) => snapshot.summary.valuation.state !== 'complete-priced');

  // Internal transfers: an outflow on one included account and an inflow
  // on another included account inside the same confirmed transaction on
  // the same chain and network. Movement, not economic flow.
  const internalTransfers = detectInternalTransfers(events);

  const external = externalFlows(events, new Set(internalTransfers.map((t) => `${t.chain}:${t.network}:${t.txid}`)));

  const allStates: PortfolioDataState[] = [
    ...included.map((snapshot) => snapshot.summary.aggregateState),
    ...holdings.map((holding) => holding.state),
  ];

  return {
    quoteCurrency,
    pricedTotal,
    unpricedCount,
    state: foldDataStates(allStates),
    holdings,
    byAccount: [...accountValues.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([accountId, entry]) => ({
        accountId,
        pricedValue: sumExact(entry.values),
        state: foldDataStates(entry.states),
        holdingCount: entry.count,
      })),
    externalInflowAtomic: external.inflow,
    externalOutflowAtomic: external.outflow,
    internalTransfers,
    unknownValueBucket: hasUnknownValue ? 'present' : 'absent',
    duplicateAddresses: duplicates,
  };
}

/** Deterministic internal-transfer detection from transaction evidence. */
export function detectInternalTransfers(
  events: readonly PortfolioEventInput[],
): InternalTransferCandidate[] {
  const candidates: InternalTransferCandidate[] = [];
  const seen = new Set<string>();
  for (const out of events) {
    if (out.direction !== 'out' || out.confirmationState !== 'confirmed') continue;
    const key = `${out.chain}:${out.network}:${out.txid}`;
    if (seen.has(key)) continue;
    for (const inner of events) {
      if (
        inner.direction === 'in' &&
        inner.confirmationState === 'confirmed' &&
        inner.chain === out.chain &&
        inner.network === out.network &&
        inner.txid === out.txid &&
        inner.accountId !== out.accountId
      ) {
        const quantity = minPositive(out.nativeValueAtomic, inner.nativeValueAtomic);
        if (quantity === null || BigInt(quantity) <= FEE_TOLERANCE) continue;
        candidates.push({
          chain: out.chain,
          network: out.network,
          txid: out.txid,
          fromAccountId: out.accountId,
          toAccountId: inner.accountId,
          quantityAtomic: quantity,
          feeAtomic: out.feeAtomic,
          timestamp: out.timestamp ?? inner.timestamp,
        });
        seen.add(key);
        break;
      }
    }
  }
  return candidates.sort(
    (a, b) =>
      a.chain.localeCompare(b.chain) ||
      a.txid.localeCompare(b.txid),
  );
}

/** External (non-internal) flows in exact native units. */
export function externalFlows(
  events: readonly PortfolioEventInput[],
  internalKeys: ReadonlySet<string>,
): { inflow: string | null; outflow: string | null } {
  let inflow = 0n;
  let outflow = 0n;
  let known = true;
  for (const event of events) {
    if (internalKeys.has(`${event.chain}:${event.network}:${event.txid}`)) continue;
    if (event.nativeValueAtomic === null) {
      known = false;
      continue;
    }
    const value = BigInt(event.nativeValueAtomic);
    if (event.direction === 'in') inflow += value;
    if (event.direction === 'out') outflow += -value;
  }
  return {
    inflow: known ? inflow.toString() : null,
    outflow: known ? outflow.toString() : null,
  };
}

function pickQuoteCurrency(snapshots: readonly AddressSnapshot[]): string {
  for (const snapshot of snapshots) {
    if (snapshot.summary.valuation.state !== 'unpriced') {
      return snapshot.summary.valuation.quoteCurrency;
    }
  }
  return snapshots[0]?.summary.valuation.quoteCurrency ?? 'USD';
}

function compareAssetKey(
  [a]: readonly [string, unknown],
  [b]: readonly [string, unknown],
): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function minPositive(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null;
  const left = BigInt(a);
  const right = BigInt(b);
  if (left <= 0n || right <= 0n) return null;
  return left < right ? left.toString() : right.toString();
}
