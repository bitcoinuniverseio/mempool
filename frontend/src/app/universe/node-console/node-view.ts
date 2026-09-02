import {
  ChainSection,
  MempoolSection,
  NodeOverview,
  PeersSection,
  RpcMethod,
  RpcParam,
  Section,
} from './node-console.types';

/**
 * Reading a node overview into the things a page states.
 *
 * The recurring problem this file exists for: a number from a node means
 * nothing on its own. A verification progress of 0.9997 is not "almost
 * ready", it is a node that has not finished. Blocks behind headers is not a
 * lag figure, it is the difference between what the node has heard about and
 * what it has checked. Each function below turns one of those into a
 * sentence somebody can act on, and refuses to produce one where the section
 * did not answer.
 */

export type Health = 'ready' | 'catching-up' | 'degraded' | 'unavailable';

export interface HealthLine {
  readonly health: Health;
  readonly text: string;
}

/** True when a section answered, narrowing the data to non null for callers. */
export function isReady<T>(section: Section<T> | null | undefined): section is Section<T> & { data: T } {
  return !!section && section.state === 'ready' && section.data !== null;
}

/**
 * One sentence for whether this node can be relied on right now.
 *
 * Initial block download comes first because nothing else matters while it
 * is true: a node still catching up will answer every question, and answer
 * some of them wrongly.
 */
export function chainHealth(section: Section<ChainSection> | null): HealthLine {
  if (!isReady(section)) {
    return {
      health: 'unavailable',
      text: section?.reason
        ? $localize`:@@node.health.silent:This node did not describe its chain: ${section.reason}`
        : $localize`:@@node.health.nochain:This node did not describe its chain.`,
    };
  }
  const chain = section.data;
  if (chain.initialBlockDownload) {
    return {
      health: 'catching-up',
      text: $localize`:@@node.health.ibd:Still catching up. It has validated ${chain.blocks} of the ${chain.headers} blocks it knows about, so anything it says about recent history may change.`,
    };
  }
  if (chain.blocksBehindHeaders > 0) {
    return {
      health: 'catching-up',
      text: $localize`:@@node.health.behind:Validated to block ${chain.blocks}, which is ${chain.blocksBehindHeaders} behind the headers it has seen.`,
    };
  }
  // Below one, the node has not verified everything it holds, even though it
  // has stopped downloading. Reporting that as ready would be wrong.
  if (chain.verificationProgress < 0.9999) {
    return {
      health: 'degraded',
      text: $localize`:@@node.health.unverified:At the tip, but verification is only ${percent(chain.verificationProgress)} complete.`,
    };
  }
  return {
    health: 'ready',
    text: $localize`:@@node.health.ready:At block ${chain.blocks}, fully verified, with nothing outstanding.`,
  };
}

/** A ratio as a percentage to two places, never rounded up to a whole. */
export function percent(value: number): string {
  if (!Number.isFinite(value)) { return 'unknown'; }
  // Truncated rather than rounded: 99.996 shown as 100 would say a node had
  // finished when it had not, which is the one case this figure is read for.
  const truncated = Math.floor(value * 10_000) / 100;
  return `${truncated.toFixed(2)}%`;
}

/** Bytes as a human size, in binary units, to one decimal. */
export function bytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) { return 'unknown'; }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`;
}

/** A duration in seconds as the largest unit that stays readable. */
export function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) { return 'unknown'; }
  if (seconds < 60) { return `${Math.floor(seconds)}s`; }
  if (seconds < 3600) { return `${Math.floor(seconds / 60)}m`; }
  if (seconds < 86400) { return `${Math.floor(seconds / 3600)}h`; }
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * What the node's mempool policy means for somebody sending a transaction.
 *
 * The three fee floors are separate things that a reader will otherwise
 * conflate. The minimum relay fee is the node's configured floor. The mempool
 * minimum is what the floor has risen to because the mempool is full. The
 * incremental fee is what a replacement pays on top.
 */
export function policyLines(section: Section<MempoolSection> | null): string[] {
  if (!isReady(section)) { return []; }
  const policy = section.data;
  const lines: string[] = [
    $localize`:@@node.policy.relay:It will not relay a transaction below ${round(policy.minRelayFeeSatPerVb)} sat/vB.`,
  ];
  if (policy.mempoolMinFeeSatPerVb > policy.minRelayFeeSatPerVb) {
    lines.push($localize`:@@node.policy.full:Its mempool is full enough that the floor has risen to ${round(policy.mempoolMinFeeSatPerVb)} sat/vB. Anything below that is being turned away right now.`);
  }
  lines.push($localize`:@@node.policy.incremental:A replacement pays ${round(policy.incrementalRelayFeeSatPerVb)} sat/vB of its own size on top of everything it evicts.`);
  if (policy.fullReplacementReported) {
    lines.push(policy.fullReplacementEnabled
      ? $localize`:@@node.policy.fullrbf-on:It replaces a transaction whether or not that transaction signalled for it.`
      : $localize`:@@node.policy.fullrbf-off:It replaces only a transaction that signalled for replacement.`);
  } else {
    lines.push($localize`:@@node.policy.fullrbf-unknown:This release does not report whether it replaces unsignalled transactions, so that is not known here rather than assumed either way.`);
  }
  return lines;
}

/** A fee rate to two decimals, matching how rates read everywhere else. */
export function round(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : 'unknown';
}

/**
 * How full the mempool is, as a fraction of what the node will hold.
 *
 * Null rather than zero when the limit is not known: a mempool of unknown
 * capacity is not an empty one.
 */
export function mempoolFullness(section: Section<MempoolSection> | null): number | null {
  if (!isReady(section)) { return null; }
  const { usageBytes, maxMempoolBytes } = section.data;
  if (!Number.isFinite(maxMempoolBytes) || maxMempoolBytes <= 0) { return null; }
  return Math.min(1, usageBytes / maxMempoolBytes);
}

export interface PeerBalance {
  readonly inbound: number;
  readonly outbound: number;
  /** True when the node has no outbound connections, which is not survivable. */
  readonly noOutbound: boolean;
  /** True when it is reachable from outside, which not every node is. */
  readonly acceptsInbound: boolean;
}

/**
 * Reads the peer set for the two facts that matter about it.
 *
 * A node with no outbound connections is isolated from the network it thinks
 * it is on, whatever its inbound count says. Whether it accepts inbound at
 * all is a property of how it is deployed rather than a fault.
 */
export function peerBalance(section: Section<PeersSection> | null): PeerBalance | null {
  if (!isReady(section)) { return null; }
  const inbound = section.data.byNetwork.reduce((sum, entry) => sum + entry.inbound, 0);
  const outbound = section.data.byNetwork.reduce((sum, entry) => sum + entry.outbound, 0);
  return {
    inbound,
    outbound,
    noOutbound: outbound === 0,
    acceptsInbound: inbound > 0,
  };
}

/** How many sections answered, so a page can say what it is missing. */
export function sectionsAnswered(overview: NodeOverview | null): { ready: number; total: number } {
  if (!overview) { return { ready: 0, total: 0 }; }
  const sections = [overview.chain, overview.indexes, overview.mempool, overview.network, overview.peers];
  return {
    ready: sections.filter((section) => section.state === 'ready').length,
    total: sections.length,
  };
}

/** Methods grouped by category, each group in the catalog's own order. */
export function groupByCategory(methods: readonly RpcMethod[]): { category: string; methods: RpcMethod[] }[] {
  const order = ['chain', 'mempool', 'network', 'mining', 'decode'];
  const groups = new Map<string, RpcMethod[]>();
  for (const method of methods) {
    groups.set(method.category, [...(groups.get(method.category) ?? []), method]);
  }
  return order
    .filter((category) => groups.has(category))
    .map((category) => ({ category, methods: groups.get(category) as RpcMethod[] }));
}

/** Catalog entries whose name or summary contains the query, case blind. */
export function searchMethods(methods: readonly RpcMethod[], query: string): RpcMethod[] {
  const needle = (query ?? '').trim().toLowerCase();
  if (!needle) { return [...methods]; }
  return methods.filter((method) =>
    method.name.toLowerCase().includes(needle)
    || method.summary.toLowerCase().includes(needle));
}

/**
 * Checks arguments the same way the server will, before sending them.
 *
 * The server is the authority and rechecks everything; this exists so a
 * mistake is reported next to the field that caused it instead of arriving
 * as a four hundred with no field attached.
 */
export function firstArgumentProblem(
  params: readonly RpcParam[],
  values: readonly string[],
): { index: number; message: string } | null {
  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    const value = (values[i] ?? '').trim();
    if (!value) {
      if (param.required) {
        return { index: i, message: $localize`:@@node.rpc.required:${param.name} is needed.` };
      }
      // An optional argument left blank ends the list, so anything after it
      // is not sent either and there is nothing further to check.
      return null;
    }
    const problem = checkOne(param, value);
    if (problem) { return { index: i, message: problem }; }
  }
  return null;
}

function checkOne(param: RpcParam, value: string): string | null {
  switch (param.type) {
    case 'txid':
    case 'blockhash':
      return /^[0-9a-fA-F]{64}$/.test(value)
        ? null
        : $localize`:@@node.rpc.bad-hash:${param.name} is 64 hexadecimal characters.`;
    case 'hex':
      if (!/^[0-9a-fA-F]+$/.test(value)) {
        return $localize`:@@node.rpc.bad-hex:${param.name} is hexadecimal only.`;
      }
      return value.length % 2 === 0
        ? null
        : $localize`:@@node.rpc.odd-hex:${param.name} has an odd number of characters.`;
    case 'height':
    case 'index': {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 0
        ? null
        : $localize`:@@node.rpc.bad-whole:${param.name} is a whole number, zero or more.`;
    }
    case 'count': {
      const parsed = Number(value);
      const max = param.max ?? 1000;
      return Number.isInteger(parsed) && parsed >= 1 && parsed <= max
        ? null
        : $localize`:@@node.rpc.bad-count:${param.name} is a whole number from 1 to ${max}.`;
    }
    case 'bool':
      return value === 'true' || value === 'false'
        ? null
        : $localize`:@@node.rpc.bad-bool:${param.name} is true or false.`;
    case 'address':
      return /^[0-9a-zA-Z]{14,110}$/.test(value)
        ? null
        : $localize`:@@node.rpc.bad-address:${param.name} is not the shape of an address.`;
    default:
      return null;
  }
}
