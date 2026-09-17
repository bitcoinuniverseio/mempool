/**
 * Owned usage accounting for authenticated developer requests.
 *
 * Every request that authenticates an API key through `requireOwner` is
 * recorded here when its response finishes: the owner, the key, the status
 * class and the wall-clock latency. The ledger lives in this process's
 * memory, so what it can answer is exactly what this backend instance has
 * observed since it started, and it says so. It is bounded per owner and in
 * the number of owners it tracks; an owner it has never seen has no
 * observations, which is a distinct answer from zero requests.
 */

export const USAGE_LEDGER_LIMITS = {
  owners: 5_000,
  latencySamples: 512,
  keysPerOwner: 64,
} as const;

interface KeyCounters {
  key_id: string;
  requests: number;
  first_observed_at: string;
  last_observed_at: string;
}

interface OwnerCounters {
  owner_id: string;
  requests_total: number;
  responses_2xx: number;
  responses_4xx: number;
  responses_5xx: number;
  rate_limited: number;
  first_observed_at: string;
  last_observed_at: string;
  latencies_ms: number[];
  keys: Map<string, KeyCounters>;
}

export interface OwnerUsageObservation {
  state: 'observed';
  owner_id: string;
  requests_total: number;
  responses_2xx: number;
  responses_4xx: number;
  responses_5xx: number;
  rate_limited: number;
  latency_ms: { p50: number; p95: number; max: number; samples: number };
  keys: Array<{ key_id: string; requests: number; first_observed_at: string; last_observed_at: string }>;
  first_observed_at: string;
  last_observed_at: string;
}

export interface OwnerUsageAbsent {
  state: 'no-observations';
  owner_id: string;
}

export interface UsageLedgerCoverage {
  observer_id: string;
  persistence: 'process-memory-only';
  observed_since: string;
  observed_at: string;
  scope: string;
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) { return 0; }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

export class OwnerUsageLedger {
  private owners = new Map<string, OwnerCounters>();
  private readonly startedAt: string;

  constructor(private readonly now: () => number = Date.now, public readonly observerId = 'explorer-backend-' + process.pid) {
    this.startedAt = new Date(this.now()).toISOString();
  }

  public record(ownerId: string, keyId: string, status: number, latencyMs: number): void {
    if (!ownerId) { return; }
    const at = new Date(this.now()).toISOString();
    let owner = this.owners.get(ownerId);
    if (!owner) {
      if (this.owners.size >= USAGE_LEDGER_LIMITS.owners) {
        // Bounded: drop the owner that has been quiet the longest.
        const oldest = this.owners.keys().next().value;
        if (oldest !== undefined) { this.owners.delete(oldest); }
      }
      owner = { owner_id: ownerId, requests_total: 0, responses_2xx: 0, responses_4xx: 0, responses_5xx: 0, rate_limited: 0, first_observed_at: at, last_observed_at: at, latencies_ms: [], keys: new Map() };
    }
    this.owners.delete(ownerId);
    this.owners.set(ownerId, owner);
    owner.requests_total++;
    if (status >= 500) { owner.responses_5xx++; } else if (status >= 400) { owner.responses_4xx++; } else if (status >= 200 && status < 300) { owner.responses_2xx++; }
    if (status === 429) { owner.rate_limited++; }
    owner.last_observed_at = at;
    owner.latencies_ms.push(Math.max(0, Math.round(latencyMs)));
    if (owner.latencies_ms.length > USAGE_LEDGER_LIMITS.latencySamples) { owner.latencies_ms.shift(); }
    const key = owner.keys.get(keyId);
    if (key) {
      key.requests++;
      key.last_observed_at = at;
    } else if (owner.keys.size < USAGE_LEDGER_LIMITS.keysPerOwner) {
      owner.keys.set(keyId, { key_id: keyId, requests: 1, first_observed_at: at, last_observed_at: at });
    }
  }

  /** The owner's own counters and nothing else; a foreign owner id reads as absent. */
  public read(ownerId: string): OwnerUsageObservation | OwnerUsageAbsent {
    const owner = this.owners.get(ownerId);
    if (!owner) { return { state: 'no-observations', owner_id: ownerId }; }
    const sorted = [...owner.latencies_ms].sort((a, b) => a - b);
    return {
      state: 'observed',
      owner_id: owner.owner_id,
      requests_total: owner.requests_total,
      responses_2xx: owner.responses_2xx,
      responses_4xx: owner.responses_4xx,
      responses_5xx: owner.responses_5xx,
      rate_limited: owner.rate_limited,
      latency_ms: { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted[sorted.length - 1] ?? 0, samples: sorted.length },
      keys: [...owner.keys.values()].map(key => ({ ...key })),
      first_observed_at: owner.first_observed_at,
      last_observed_at: owner.last_observed_at,
    };
  }

  public coverage(): UsageLedgerCoverage {
    return {
      observer_id: this.observerId,
      persistence: 'process-memory-only',
      observed_since: this.startedAt,
      observed_at: new Date(this.now()).toISOString(),
      scope: 'Requests authenticated with an API key by this backend instance since it started. Other instances, restarts and unauthenticated requests are not counted.',
    };
  }

  /** Test seam. */
  public resetForTests(): void {
    this.owners.clear();
  }
}

export const ownerUsageLedger = new OwnerUsageLedger();
