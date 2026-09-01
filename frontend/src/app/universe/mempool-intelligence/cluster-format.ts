import { ClusterFreshness } from './mempool-intelligence.types';

/**
 * Formatting and wording shared by every cluster surface.
 *
 * Pure, so the exact strings a reader sees can be asserted. The wording is
 * the product here as much as the numbers are: a page that says "live" about
 * a four second old snapshot has made a claim it cannot support.
 */

export type FreshnessTone = 'proven' | 'partial' | 'unavailable';

export interface FreshnessView {
  readonly tone: FreshnessTone;
  readonly label: string;
  readonly detail: string;
  readonly ageSeconds: number;
}

/** An age past this is old enough that the reader should be told plainly. */
const STALE_AFTER_MS = 60_000;

/**
 * Describes how old a cluster snapshot is.
 *
 * Three states rather than two. Inside the budget the answer is current.
 * Past the budget but recent, it is a real answer that has simply aged, which
 * is different from an answer so old it should not be trusted to describe the
 * mempool at all.
 */
export function describeFreshness(freshness: ClusterFreshness | null): FreshnessView | null {
  if (!freshness) { return null; }
  const ageSeconds = Math.max(0, Math.round(freshness.ageMs / 1000));
  if (freshness.withinBudget) {
    return {
      tone: 'proven',
      ageSeconds,
      label: $localize`:@@mempool.freshness.current:Current`,
      detail: $localize`:@@mempool.freshness.current-detail:Built from this node mempool moments ago. Clusters change as transactions arrive and blocks are found.`,
    };
  }
  if (freshness.ageMs < STALE_AFTER_MS) {
    return {
      tone: 'partial',
      ageSeconds,
      label: $localize`:@@mempool.freshness.aged:Slightly behind`,
      detail: $localize`:@@mempool.freshness.aged-detail:This snapshot has aged past its budget. It still describes a real mempool, just not the one this node holds right now.`,
    };
  }
  return {
    tone: 'unavailable',
    ageSeconds,
    label: $localize`:@@mempool.freshness.stale:Out of date`,
    detail: $localize`:@@mempool.freshness.stale-detail:This snapshot is old enough that it may no longer describe the mempool. Nothing is claimed about the present from it.`,
  };
}

/** Groups digits without ever going through a float. */
function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** An integer satoshi count, grouped. */
export function formatSats(value: number): string {
  if (!Number.isFinite(value)) { return ''; }
  const rounded = Math.round(value);
  const negative = rounded < 0;
  return (negative ? '-' : '') + groupDigits(String(Math.abs(rounded)));
}

/** An integer vbyte count, grouped. */
export function formatVsize(value: number): string {
  return formatSats(value);
}

/**
 * A fee rate, to two decimals.
 *
 * Two decimals because that is the resolution at which a reader can act, and
 * because more digits would suggest the rate is an exact quantity when it is
 * a ratio of two exact ones.
 */
export function formatFeerate(value: number): string {
  if (!Number.isFinite(value)) { return ''; }
  return value.toFixed(2);
}

/** Short form of a 64 character identifier. */
export function shorten(value: string, keep = 8): string {
  if (typeof value !== 'string' || value.length <= keep * 2 + 1) { return value ?? ''; }
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

/**
 * Plain language for what a chunk is, given its position.
 *
 * The first chunk of a cluster is what a miner would take from it. Later
 * chunks are only reached once the ones above them have been taken, which is
 * the thing readers most often get wrong about mempool ordering.
 */
export function describeChunk(index: number, total: number): string {
  if (total <= 1) {
    return $localize`:@@mempool.chunk.only:The whole cluster is mined as one group at one fee rate.`;
  }
  if (index === 0) {
    return $localize`:@@mempool.chunk.first:The group a miner takes first from this cluster.`;
  }
  return $localize`:@@mempool.chunk.later:Reached only after every group above it has been taken.`;
}
