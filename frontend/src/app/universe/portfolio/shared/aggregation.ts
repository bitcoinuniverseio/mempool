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
  readonly eventId?: string;
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
  readonly nativeFlows?: readonly NativeFlow[];
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

export interface NativeFlow {
  readonly state: PortfolioDataState;
  readonly chain: string;
  readonly network: string;
  readonly asset: string;
  readonly decimals: number;
  readonly inflow: string | null;
  readonly outflow: string | null;
}

export function nativeUnit(chain: string): { asset: string; decimals: number } {
  const asset = ({ bitcoin: 'BTC', dogecoin: 'DOGE', zcash: 'ZEC', liquid: 'L-BTC' } as Record<string, string>)[chain];
  return asset ? { asset, decimals: 8 } : { asset: `${chain} atomic units`, decimals: 0 };
}

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
    const addressKey = JSON.stringify([snapshot.chain, snapshot.network, snapshot.address]);
    const existing = claimedBy.get(addressKey);
    if (existing === undefined) {
      claimedBy.set(addressKey, policy[snapshot.address] ?? snapshot.accountId);
    } else if (existing !== (policy[snapshot.address] ?? snapshot.accountId)) {
      if (!duplicates.includes(snapshot.address)) duplicates.push(snapshot.address);
      if (policy[snapshot.address] === undefined && snapshot.accountId < existing) claimedBy.set(addressKey, snapshot.accountId);
    }
  }
  const included = snapshots.filter(
    (snapshot) =>
      claimedBy.get(JSON.stringify([snapshot.chain, snapshot.network, snapshot.address])) === snapshot.accountId &&
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

  /**
   * IMPLEMENTATION-HANDOFF [WP-FE-004] | D-FE-004 | C-FE-PF-ACCOUNT-VALUE.
   * loadAddress emits one AddressSnapshot per native/protocol asset, each with
   * the same address-wide summary valuation. This loop adds that summary once
   * per asset: a 10 USD native holding plus a 20 USD token yields portfolio=30
   * but byAccount=60. Actual-source reproduction: frontend-reproductions.json.
   * Governing contract: shared/universe-portfolio-v2.types.ts summary.valuation
   * is address-wide; portfolio-data.service.ts creates the repeated snapshots.
   * 1. Build an included-address map keyed by chain/network/address/account ID;
   *    add each address summary valuation exactly once to its selected account.
   *    Preserve the inclusion policy and reject inconsistent repeated summaries.
   * 2. Derive per-account distinct holding counts separately from summary totals.
   *    Fold source failures/completeness from WP-FE-002/003 pessimistically and
   *    never combine different quote currencies or account contexts as one sum.
   * 3. Extend aggregation.spec.ts with native+one token, native+many tokens,
   *    multiple addresses sharing an asset, duplicated address inclusion and
   *    mixed quotes. Assert total=30/byAccount=30 in the reproduced fixture.
   *    Run npm test -- --maxWorkers=2 src/app/universe/portfolio/shared/aggregation.spec.ts
   *    and portfolio-data.service.spec.ts; reconcile downstream reports/insights.
   * Acceptance: exact per-address, per-account and portfolio readback reconciles
   *    on Signet without an asset-count multiplier. No migration is needed;
   *    invalidate derived cached totals on rollout/rollback, retain vault inputs.
   */
  const accountValues = new Map<string, { values: string[]; states: PortfolioDataState[]; assets: Set<string> }>();
  const summaries = new Map<string, string>();
  for (const snapshot of included) {
    const entry = accountValues.get(snapshot.accountId) ?? { values: [], states: [], assets: new Set<string>() };
    const key = JSON.stringify([snapshot.chain, snapshot.network, snapshot.address, snapshot.accountId]);
    const prior = summaries.get(key);
    const summary = JSON.stringify(snapshot.summary);
    if (prior === undefined && snapshot.summary.valuation.quoteCurrency === quoteCurrency) {
      entry.values.push(snapshot.summary.valuation.pricedValue);
    }
    if (prior !== undefined && prior !== summary) entry.states.push('partial');
    if (snapshot.summary.valuation.quoteCurrency !== quoteCurrency) entry.states.push('partial');
    summaries.set(key, summary);
    entry.states.push(snapshot.summary.aggregateState);
    entry.assets.add(snapshot.holdings.assetKey);
    accountValues.set(snapshot.accountId, entry);
  }

  const pricedTotal = sumExact(
    holdings.map((holding) => holding.pricedValue ?? '0'),
  );
  const hasUnknownValue =
    holdings.some((holding) => holding.quantityAtomic === null) ||
    holdings.some((holding) => holding.pricedValue === null && holding.valuationState !== 'not-applicable') ||
    included.some((snapshot) => snapshot.summary.valuation.state !== 'complete-priced' || !['proven', 'live'].includes(snapshot.summary.aggregateState))
    || [...accountValues.values()].some(entry => entry.states.some(state => !['proven', 'live'].includes(state)));

  // Internal transfers: an outflow on one included account and an inflow
  // on another included account inside the same confirmed transaction on
  // the same chain and network. Movement, not economic flow.
  const selectedEvents = [...new Map(events.filter(event => claimedBy.get(JSON.stringify([event.chain, event.network, event.address])) === event.accountId)
    .map(event => [JSON.stringify([event.chain, event.network, event.address, event.eventId ?? event.txid, event.eventType]), event])).values()];
  const internalTransfers = detectInternalTransfers(selectedEvents);

  const internalKeys = new Set(internalTransfers.map((t) => `${t.chain}:${t.network}:${t.txid}`));
  const groups = new Map<string, PortfolioEventInput[]>();
  for (const event of selectedEvents) {
    const key = JSON.stringify([event.chain, event.network]);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const nativeFlows = [...groups.values()].map(group => ({ chain: group[0].chain, network: group[0].network,
    state: foldDataStates([...group.map(event => event.sourceState), ...included.filter(snapshot => snapshot.chain === group[0].chain && snapshot.network === group[0].network).map(snapshot => snapshot.summary.aggregateState)]),
    ...nativeUnit(group[0].chain), ...externalFlows(group, internalKeys) }));
  const external = nativeFlows.length === 1 ? nativeFlows[0] : { inflow: null, outflow: null };

  const allStates: PortfolioDataState[] = [
    ...included.map((snapshot) => snapshot.summary.aggregateState),
    ...holdings.map((holding) => holding.state),
    ...[...accountValues.values()].flatMap(entry => entry.states),
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
        pricedValue: entry.values.length ? sumExact(entry.values) : null,
        state: foldDataStates(entry.states),
        holdingCount: entry.assets.size,
      })),
    externalInflowAtomic: external.inflow,
    externalOutflowAtomic: external.outflow,
    nativeFlows,
    internalTransfers,
    unknownValueBucket: hasUnknownValue ? 'present' : 'absent',
    duplicateAddresses: duplicates,
  };
}

/** Deterministic internal-transfer detection from transaction evidence. */
/**
 * IMPLEMENTATION-HANDOFF [WP-FE-005] | D-FE-005A/B | C-FE-PF-INTERNAL/MULTICHAIN-FLOW.
 * The owning semantic-event contract defines nativeValueAtomic as a signed
 * per-address effect. minPositive rejects a valid -1100 debit, so its paired
 * +1000 owned credit is incorrectly shown as external. externalFlows also adds
 * native units across chains/networks, then overview.component.ts labels every
 * result BTC. Reproduction: 1 BTC + 2 DOGE -> combined 300000000 -> 3 BTC label.
 * Source: PortfolioSemanticEvent in shared/universe-portfolio-v2.types.ts and
 * evidence/frontend-reproductions.json; amounts must remain exact strings/BigInt.
 * 1. Group included, deduplicated events by chain/network/native asset/txid;
 *    enforce the signed direction contract. Normalize debit magnitude only
 *    for matching; retain signed effects for reconciliation and separate fees.
 * 2. Match owned movement against actual input/output or counterparty evidence,
 *    including multiple owned recipients and mixed external recipients. A shared
 *    txid alone does not make the whole transaction internal. If current event
 *    fields cannot prove an amount, expose unresolved movement and extend the
 *    owning backend-apis event contract before asserting that amount.
 * 3. Replace the two unscoped native totals with an explicit per-chain/network/
 *    asset/unit flow result. Update aggregatePortfolio, OverviewComponent.drivers,
 *    reports/insights and their tests together; retain incomplete history state
 *    from WP-FE-003. Never sum different native assets or relabel them as BTC.
 * 4. Extend aggregation.spec.ts with -1100/+1000 plus fee100, >1 owned recipient,
 *    external+internal outputs, missing prevouts, duplicates/inclusion filters,
 *    same txid across networks, reorg and >2^53 values. Test 1 BTC and 2 DOGE as
 *    distinct rows. npm test -- --maxWorkers=2 src/app/universe/portfolio.
 * Acceptance: real Signet owned transfer and authoritative persisted readback,
 *    plus a controlled mixed-asset fixture; use justified testnet for Dogecoin.
 * Dependencies: WP-FE-002/003 read coverage; coordinate any contract change with
 *    backend-apis before regenerating the shared types. No transaction signing
 *    belongs here. Version/invalidate derived snapshots on rollout; rollback
 *    must retain user vault data and must not restore mixed-unit totals.
 */
export function detectInternalTransfers(
  events: readonly PortfolioEventInput[],
): InternalTransferCandidate[] {
  const candidates: InternalTransferCandidate[] = [];
  const seen = new Set<string>();
  const transactions = new Map<string, PortfolioEventInput[]>();
  for (const event of events) {
    const key = `${event.chain}:${event.network}:${event.txid}`;
    const group = transactions.get(key) ?? [];
    group.push(event);
    transactions.set(key, group);
  }
  for (const transactionEvents of transactions.values()) {
    if (transactionEvents.length !== 2) continue;
    const out = transactionEvents.find(event => event.direction === 'out');
    if (!out) continue;
    if (out.direction !== 'out' || out.confirmationState !== 'confirmed') continue;
    if (transactionEvents.some(event => !['proven', 'live'].includes(event.sourceState))) continue;
    const key = `${out.chain}:${out.network}:${out.txid}`;
    if (seen.has(key)) continue;
    for (const inner of transactionEvents) {
      if (
        inner.direction === 'in' &&
        inner.confirmationState === 'confirmed' &&
        inner.chain === out.chain &&
        inner.network === out.network &&
        inner.txid === out.txid &&
        inner.accountId !== out.accountId &&
        out.counterparties.includes(inner.address) && inner.counterparties.includes(out.address)
      ) {
        if (!exactInteger(out.nativeValueAtomic) || !exactInteger(inner.nativeValueAtomic) || !exactInteger(out.feeAtomic)) continue;
        const debit = BigInt(out.nativeValueAtomic);
        const credit = BigInt(inner.nativeValueAtomic);
        const fee = BigInt(out.feeAtomic);
        // Only a fully reconciled bilateral movement is proven by this contract.
        // Mixed recipients and absent input/output evidence remain external.
        if (debit >= 0n || credit <= 0n || fee < 0n || -debit !== credit + fee) continue;
        const quantity = credit.toString();
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
/**
 * IMPLEMENTATION-HANDOFF [WP-FE-005] | D-FE-005B | C-FE-PF-MULTICHAIN-FLOW.
 * Replace this cross-chain accumulator with the explicit scoped result defined
 * beside detectInternalTransfers. Preserve signed amounts and fee accounting;
 * update every consumer in one change. The current bigint sums are numerically
 * exact but dimensionally wrong. Shared work-package tests cover units, inclusion,
 * incomplete histories, integration acceptance and derived-state rollback.
 */
export function externalFlows(
  events: readonly PortfolioEventInput[],
  internalKeys: ReadonlySet<string>,
): { inflow: string | null; outflow: string | null } {
  let inflow = 0n;
  let outflow = 0n;
  let known = true;
  const directions = new Map<string, { incoming: Set<string>; outgoing: Set<string> }>();
  for (const event of events) {
    const key = `${event.chain}:${event.network}:${event.txid}`;
    const group = directions.get(key) ?? { incoming: new Set<string>(), outgoing: new Set<string>() };
    if (event.direction === 'in') group.incoming.add(event.accountId);
    if (event.direction === 'out') group.outgoing.add(event.accountId);
    directions.set(key, group);
  }
  for (const event of events) {
    if (internalKeys.has(`${event.chain}:${event.network}:${event.txid}`)) continue;
    // Opposite owned effects without a reconciled movement are ambiguous.
    // Their internal portions cannot be reported as external economic flow.
    const group = directions.get(`${event.chain}:${event.network}:${event.txid}`);
    const opposite = event.direction === 'in' ? group?.outgoing : event.direction === 'out' ? group?.incoming : undefined;
    if (opposite && (opposite.size > 1 || (opposite.size === 1 && !opposite.has(event.accountId)))) {
      known = false;
      continue;
    }
    if (event.direction === 'unknown') { known = false; continue; }
    if (!exactInteger(event.nativeValueAtomic)) {
      known = false;
      continue;
    }
    const value = BigInt(event.nativeValueAtomic);
    if ((event.direction === 'in' && value < 0n) || (event.direction === 'out' && value > 0n) || !['proven', 'live'].includes(event.sourceState)) { known = false; continue; }
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

function exactInteger(value: string | null): value is string {
  return typeof value === 'string' && /^-?(0|[1-9][0-9]{0,127})$/.test(value);
}
