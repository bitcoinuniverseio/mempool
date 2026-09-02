import { PortfolioSummary } from '@app/universe/portfolio/portfolio.types';
import { WatchedAddress } from '@app/universe/portfolio/portfolio-watchlist.service';

/**
 * What many addresses add up to, exactly.
 *
 * Quantities on this page are exact integers or exact decimal strings, never
 * floating point, because a balance that drifts by one sat is a lie. Native
 * sums are BigInt additions of atomic quantities. Valuations are added as
 * scale aligned decimal strings, grouped by their own quote currency: two
 * answers in different currencies are never silently merged into one number.
 *
 * An address whose summary did not answer contributes nothing to the sums
 * and is listed, with its reason, in the failures. A failed source never
 * becomes a zero.
 */

export interface AddressOutcome {
  readonly entry: WatchedAddress;
  readonly state: 'ready' | 'failed';
  /** Present when ready and the chain's native balance is known. */
  readonly nativeAtomic: string | null;
  readonly holdingCount: number | null;
  /** Present when ready and a priced valuation exists, with its currency. */
  readonly valuedAtomic: string | null;
  readonly quoteCurrency: string | null;
  /** Why a summary is not contributing, when it is not contributing. */
  readonly reason: string | null;
  readonly warnings: readonly string[];
}

export interface AssetTotal {
  readonly key: string;
  readonly atomic: string;
  readonly addresses: number;
}

export interface ValuationTotal {
  readonly quoteCurrency: string;
  readonly value: string;
  readonly addresses: number;
}

export interface WorkspaceAggregate {
  readonly outcomes: readonly AddressOutcome[];
  readonly nativeTotals: readonly AssetTotal[];
  readonly valuations: readonly ValuationTotal[];
  readonly groupTotals: ReadonlyMap<string, readonly AssetTotal[]>;
  readonly readyCount: number;
  readonly failedCount: number;
}

/** Adds two non negative decimal strings at the wider of their scales. */
export function addDecimalStrings(a: string, b: string): string {
  const parse = (value: string): { whole: bigint; frac: bigint; scale: number } | null => {
    const match = /^(\d+)(?:\.(\d{1,18}))?$/.exec(value);
    if (!match) { return null; }
    const fracText = match[2] ?? '';
    return { whole: BigInt(match[1] || '0'), frac: BigInt(fracText || '0'), scale: fracText.length };
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) { return '0'; }
  const scale = Math.max(left.scale, right.scale);
  const factor = 10n ** BigInt(scale);
  const aligned = (part: { whole: bigint; frac: bigint; scale: number }): bigint =>
    part.whole * factor + part.frac * (10n ** BigInt(scale - part.scale));
  const total = aligned(left) + aligned(right);
  if (scale === 0) { return total.toString(); }
  const whole = total / factor;
  const frac = (total % factor).toString().padStart(scale, '0');
  return `${whole}.${frac}`;
}

function outcomeOf(entry: WatchedAddress, summary: PortfolioSummary | null, reason: string | null): AddressOutcome {
  if (!summary) {
    return {
      entry,
      state: 'failed',
      nativeAtomic: null,
      holdingCount: null,
      valuedAtomic: null,
      quoteCurrency: null,
      reason: reason ?? 'The portfolio authority did not answer.',
      warnings: [],
    };
  }
  const native = summary.nativeBalance;
  const nativeAtomic = native?.quantityAtomic ?? null;
  const valued = summary.valuation.state !== 'unpriced' && summary.valuation.pricedValue !== null;
  return {
    entry,
    state: 'ready',
    nativeAtomic,
    holdingCount: summary.totalHoldingCount,
    valuedAtomic: valued ? summary.valuation.pricedValue : null,
    quoteCurrency: valued ? summary.valuation.quoteCurrency : null,
    reason: nativeAtomic === null ? 'The native balance was not stated, so it is not summed.' : null,
    warnings: summary.envelope.warnings ?? [],
  };
}

/** Builds the aggregate from every watched address's outcome. */
export function aggregateWorkspace(
  results: ReadonlyMap<string, { summary: PortfolioSummary | null; reason: string | null }>,
  watched: readonly WatchedAddress[],
): WorkspaceAggregate {
  const outcomes: AddressOutcome[] = watched.map((entry) => {
    const result = results.get(watchKeyOf(entry));
    return outcomeOf(entry, result?.summary ?? null, result?.reason ?? null);
  });

  const nativeTotals = new Map<string, AssetTotal>();
  const valuations = new Map<string, ValuationTotal>();
  const groups = new Map<string, Map<string, AssetTotal>>();

  for (const outcome of outcomes) {
    if (outcome.state !== 'ready') { continue; }
    const chain = outcome.entry.chain;
    if (outcome.nativeAtomic !== null) {
      const existing = nativeTotals.get(chain);
      const next: AssetTotal = existing
        ? { key: chain, atomic: addAtomic(existing.atomic, outcome.nativeAtomic), addresses: existing.addresses + 1 }
        : { key: chain, atomic: outcome.nativeAtomic, addresses: 1 };
      nativeTotals.set(chain, next);

      const group = outcome.entry.group || 'ungrouped';
      const groupChains = groups.get(group) ?? new Map<string, AssetTotal>();
      const groupExisting = groupChains.get(chain);
      groupChains.set(chain, groupExisting
        ? { key: chain, atomic: addAtomic(groupExisting.atomic, outcome.nativeAtomic), addresses: groupExisting.addresses + 1 }
        : { key: chain, atomic: outcome.nativeAtomic, addresses: 1 });
      groups.set(group, groupChains);
    }
    if (outcome.valuedAtomic !== null && outcome.quoteCurrency) {
      const existing = valuations.get(outcome.quoteCurrency);
      valuations.set(outcome.quoteCurrency, {
        quoteCurrency: outcome.quoteCurrency,
        value: existing
          ? addDecimalStrings(existing.value, outcome.valuedAtomic)
          : outcome.valuedAtomic,
        addresses: (existing?.addresses ?? 0) + 1,
      });
    }
  }

  const groupTotals = new Map<string, readonly AssetTotal[]>();
  for (const [group, chains] of groups) {
    groupTotals.set(group, [...chains.values()].sort((a, b) => a.key < b.key ? -1 : 1));
  }

  return {
    outcomes,
    nativeTotals: [...nativeTotals.values()].sort((a, b) => a.key < b.key ? -1 : 1),
    valuations: [...valuations.values()].sort((a, b) => a.quoteCurrency < b.quoteCurrency ? -1 : 1),
    groupTotals,
    readyCount: outcomes.filter((outcome) => outcome.state === 'ready').length,
    failedCount: outcomes.filter((outcome) => outcome.state === 'failed').length,
  };
}

/** Exact integer addition for atomic quantities; malformed input never sums. */
export function addAtomic(a: string, b: string): string {
  const clean = (value: string): bigint | null => {
    if (!/^\d+$/.test(value)) { return null; }
    return BigInt(value);
  };
  const left = clean(a);
  const right = clean(b);
  if (left === null || right === null) { return '0'; }
  return (left + right).toString();
}

function watchKeyOf(entry: WatchedAddress): string {
  return `${entry.chain}:${entry.network}:${entry.address}`;
}

const CSV_COLUMNS = ['address', 'chain', 'network', 'group', 'native_atomic', 'holdings', 'value', 'quote'] as const;

function csvField(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The aggregate as CSV, one row per watched address. */
export function aggregateCsv(aggregate: WorkspaceAggregate): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const outcome of aggregate.outcomes) {
    lines.push([
      outcome.entry.address,
      outcome.entry.chain,
      outcome.entry.network,
      outcome.entry.group,
      outcome.nativeAtomic ?? '',
      outcome.holdingCount ?? '',
      outcome.valuedAtomic ?? '',
      outcome.quoteCurrency ?? '',
    ].map(csvField).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** The aggregate as versioned JSON, failures included. */
export function aggregateJson(aggregate: WorkspaceAggregate): string {
  return JSON.stringify({
    schemaVersion: 'universe-portfolio-workspace-v1',
    readyCount: aggregate.readyCount,
    failedCount: aggregate.failedCount,
    nativeTotals: aggregate.nativeTotals,
    valuations: aggregate.valuations,
    outcomes: aggregate.outcomes.map((outcome) => ({
      address: outcome.entry.address,
      chain: outcome.entry.chain,
      network: outcome.entry.network,
      group: outcome.entry.group,
      state: outcome.state,
      nativeAtomic: outcome.nativeAtomic,
      holdingCount: outcome.holdingCount,
      valuedAtomic: outcome.valuedAtomic,
      quoteCurrency: outcome.quoteCurrency,
      reason: outcome.reason,
      warnings: outcome.warnings,
    })),
  }, null, 2);
}
