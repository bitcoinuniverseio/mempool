import bitcoinClient from '../bitcoin/bitcoin-client';
import { redactPeerInfo } from './rpc-allowlist';

/**
 * What this node is, gathered section by section.
 *
 * Every section is fetched on its own and reports its own state. A node that
 * answers about its chain but not about its peers produces a page with the
 * chain on it and a stated reason where the peers would be, rather than an
 * error page or, worse, a peer count of zero.
 *
 * Nothing here reports an address. A peer's location is this node's topology,
 * and the counts below are built from peers whose addresses were removed
 * before they reached this file.
 */

export type SectionState = 'ready' | 'unavailable';

export interface Section<T> {
  readonly state: SectionState;
  /** Present when the state is ready. */
  readonly data: T | null;
  /** Present when it is not, saying what the node said. */
  readonly reason: string | null;
}

export interface ChainSection {
  readonly chain: string;
  readonly blocks: number;
  readonly headers: number;
  /** True while the node is still catching up and its tip is not the tip. */
  readonly initialBlockDownload: boolean;
  /** Zero to one. Below one, the node has not verified everything it holds. */
  readonly verificationProgress: number;
  readonly pruned: boolean;
  readonly sizeOnDiskBytes: number | null;
  readonly difficulty: number | null;
  /** How far behind the headers the validated tip is, in blocks. */
  readonly blocksBehindHeaders: number;
}

export interface IndexSection {
  readonly name: string;
  readonly synced: boolean;
  readonly bestBlockHeight: number;
}

export interface MempoolSection {
  readonly transactionCount: number;
  readonly virtualSize: number;
  readonly usageBytes: number;
  readonly maxMempoolBytes: number;
  readonly minRelayFeeSatPerVb: number;
  readonly incrementalRelayFeeSatPerVb: number;
  readonly mempoolMinFeeSatPerVb: number;
  /** True when the node replaces a transaction that never signalled. */
  readonly fullReplacementEnabled: boolean;
  /** Null on a node whose release does not report the setting. */
  readonly fullReplacementReported: boolean;
}

export interface NetworkSection {
  readonly version: number;
  readonly subversion: string;
  readonly protocolVersion: number;
  readonly connections: number;
  readonly connectionsIn: number;
  readonly connectionsOut: number;
  /** Which networks the node can reach, by name. */
  readonly reachable: readonly string[];
  readonly relayFeeSatPerVb: number;
}

export interface PeerSummary {
  readonly network: string;
  readonly inbound: number;
  readonly outbound: number;
  /** How many of them relay transactions to this node. */
  readonly relaying: number;
}

export interface PeersSection {
  readonly total: number;
  readonly byNetwork: readonly PeerSummary[];
  /** Distinct client versions seen, with a count of each. */
  readonly versions: readonly { subversion: string; count: number }[];
  /** The oldest connection, in seconds, which says how stable the peer set is. */
  readonly oldestConnectionSeconds: number | null;
}

export interface NodeOverview {
  readonly observedAt: string;
  readonly chain: Section<ChainSection>;
  readonly indexes: Section<readonly IndexSection[]>;
  readonly mempool: Section<MempoolSection>;
  readonly network: Section<NetworkSection>;
  readonly peers: Section<PeersSection>;
}

function ready<T>(data: T): Section<T> {
  return { state: 'ready', data, reason: null };
}

function unavailable<T>(reason: string): Section<T> {
  return { state: 'unavailable', data: null, reason };
}

function reasonOf(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.length
    ? message
    : 'The node did not answer.';
}

/** Satoshis per virtual byte from an amount stated in bitcoin per kilobyte. */
function perVb(btcPerKvb: unknown): number {
  const value = typeof btcPerKvb === 'number' && Number.isFinite(btcPerKvb) ? btcPerKvb : 0;
  return (value * 100_000_000) / 1000;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Fetches one section, turning a rejection into a stated reason.
 *
 * @asyncSafe Every failure becomes an unavailable section rather than a
 * rejection, which is the whole point: one silent node method must not take
 * the page down.
 */
async function section<T>(build: () => Promise<T>): Promise<Section<T>> {
  try {
    return ready(await build());
  } catch (e) {
    return unavailable(reasonOf(e));
  }
}

/**
 * @asyncSafe Every section catches its own failure.
 */
export async function $chainSection(): Promise<Section<ChainSection>> {
  return section(async () => {
    const info: any = /** @asyncUnsafe `section` turns this rejection into a stated reason. */ await bitcoinClient.getBlockchainInfo();
    const blocks = num(info?.blocks);
    const headers = num(info?.headers);
    let difficulty: number | null = num(info?.difficulty, Number.NaN);
    if (!Number.isFinite(difficulty)) { difficulty = null; }
    return {
      chain: typeof info?.chain === 'string' ? info.chain : 'unknown',
      blocks,
      headers,
      initialBlockDownload: info?.initialblockdownload === true,
      verificationProgress: num(info?.verificationprogress),
      pruned: info?.pruned === true,
      sizeOnDiskBytes: typeof info?.size_on_disk === 'number' ? info.size_on_disk : null,
      difficulty,
      // Never negative. A node whose headers lag its blocks is momentarily
      // inconsistent rather than ahead of itself.
      blocksBehindHeaders: Math.max(0, headers - blocks),
    };
  });
}

/**
 * @asyncSafe Every section catches its own failure.
 */
export async function $indexSection(): Promise<Section<readonly IndexSection[]>> {
  return section(async () => {
    const info: any = /** @asyncUnsafe `section` turns this rejection into a stated reason. */ await bitcoinClient.getIndexInfo();
    return Object.entries(info ?? {}).map(([name, entry]) => ({
      name,
      synced: (entry as any)?.synced === true,
      bestBlockHeight: num((entry as any)?.best_block_height),
    }));
  });
}

/**
 * @asyncSafe Every section catches its own failure.
 */
export async function $mempoolSection(): Promise<Section<MempoolSection>> {
  return section(async () => {
    const info: any = /** @asyncUnsafe `section` turns this rejection into a stated reason. */ await bitcoinClient.getMempoolInfo();
    return {
      transactionCount: num(info?.size),
      virtualSize: num(info?.bytes),
      usageBytes: num(info?.usage),
      maxMempoolBytes: num(info?.maxmempool),
      minRelayFeeSatPerVb: perVb(info?.minrelaytxfee),
      incrementalRelayFeeSatPerVb: perVb(info?.incrementalrelayfee),
      mempoolMinFeeSatPerVb: perVb(info?.mempoolminfee),
      fullReplacementEnabled: info?.fullrbf === true,
      // A release too old to have the setting reports nothing, and that is
      // different from reporting it off.
      fullReplacementReported: typeof info?.fullrbf === 'boolean',
    };
  });
}

/**
 * @asyncSafe Every section catches its own failure.
 */
export async function $networkSection(): Promise<Section<NetworkSection>> {
  return section(async () => {
    const info: any = /** @asyncUnsafe `section` turns this rejection into a stated reason. */ await bitcoinClient.getNetworkInfo();
    const networks: any[] = Array.isArray(info?.networks) ? info.networks : [];
    return {
      version: num(info?.version),
      subversion: typeof info?.subversion === 'string' ? info.subversion : 'unknown',
      protocolVersion: num(info?.protocolversion),
      connections: num(info?.connections),
      connectionsIn: num(info?.connections_in),
      connectionsOut: num(info?.connections_out),
      reachable: networks
        .filter((network) => network?.reachable === true)
        .map((network) => String(network?.name ?? 'unknown')),
      relayFeeSatPerVb: perVb(info?.relayfee),
    };
  });
}

/**
 * Counts the peers without ever holding one's address.
 *
 * The redaction runs before anything here reads a peer, so there is no point
 * in this file at which an address exists to be leaked by a later change.
 *
 * @asyncSafe Every section catches its own failure.
 */
export async function $peersSection(): Promise<Section<PeersSection>> {
  return section(async () => {
    const raw = /** @asyncUnsafe `section` turns this rejection into a stated reason. */ await bitcoinClient.getPeerInfo();
    const peers = redactPeerInfo(raw) as any[];
    if (!Array.isArray(peers)) {
      return { total: 0, byNetwork: [], versions: [], oldestConnectionSeconds: null };
    }

    const byNetwork = new Map<string, { inbound: number; outbound: number; relaying: number }>();
    const versions = new Map<string, number>();
    const now = Math.floor(Date.now() / 1000);
    let oldest: number | null = null;

    for (const peer of peers) {
      const network = typeof peer?.network === 'string' ? peer.network : 'unknown';
      const entry = byNetwork.get(network) ?? { inbound: 0, outbound: 0, relaying: 0 };
      if (peer?.inbound === true) { entry.inbound += 1; } else { entry.outbound += 1; }
      if (peer?.relaytxes === true) { entry.relaying += 1; }
      byNetwork.set(network, entry);

      const subversion = typeof peer?.subver === 'string' ? peer.subver : 'unknown';
      versions.set(subversion, (versions.get(subversion) ?? 0) + 1);

      const conntime = num(peer?.conntime, Number.NaN);
      if (Number.isFinite(conntime) && conntime > 0) {
        const age = now - conntime;
        if (age >= 0 && (oldest === null || age > oldest)) { oldest = age; }
      }
    }

    return {
      total: peers.length,
      byNetwork: [...byNetwork.entries()]
        .map(([network, counts]) => ({ network, ...counts }))
        // Largest first, then by name, so the same peer set always renders
        // in the same order.
        .sort((a, b) => (b.inbound + b.outbound) - (a.inbound + a.outbound)
          || (a.network < b.network ? -1 : a.network > b.network ? 1 : 0)),
      versions: [...versions.entries()]
        .map(([subversion, count]) => ({ subversion, count }))
        .sort((a, b) => b.count - a.count
          || (a.subversion < b.subversion ? -1 : a.subversion > b.subversion ? 1 : 0)),
      oldestConnectionSeconds: oldest,
    };
  });
}

/**
 * The whole overview.
 *
 * Sections are fetched in sequence rather than together. Each is a small
 * call, the total is five, and a sequence keeps one slow section from
 * holding open five sockets on a node whose RPC budget is shared with every
 * indexer on the host.
 *
 * @asyncSafe Every section catches its own failure.
 */
export async function $nodeOverview(): Promise<NodeOverview> {
  const chain = await $chainSection();
  const indexes = await $indexSection();
  const mempool = await $mempoolSection();
  const network = await $networkSection();
  const peers = await $peersSection();
  return {
    observedAt: new Date().toISOString(),
    chain,
    indexes,
    mempool,
    network,
    peers,
  };
}
