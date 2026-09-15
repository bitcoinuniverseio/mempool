import * as crypto from 'crypto';
import * as dns from 'dns';
import * as net from 'net';
import config from '../../../config';
import logger from '../../../logger';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import { IdentityError, isPrivateAddress, resolvePublicAddress } from '../identity/developer-identity';
import {
  GlobalNetworkSensor,
  GlobalNetworkCrawlEpoch,
  GlobalNetworkObservation,
  GlobalNetworkDnsSeed,
  GlobalNetworkSelfCheckRequest,
  GlobalNetworkSelfCheckResult,
  GlobalNetworkSnapshot,
  GlobalNetworkOverview,
} from './global-network.models';

/**
 * The network as seen from this deployment's own node.
 *
 * The revision this replaces described a global crawl that never ran:
 * 18,450 discovered nodes, four sample peers with invented latencies, ASNs
 * and countries, DNS seed statistics nobody queried, and a self-check that
 * reported every endpoint reachable with a BIP324 handshake in 38 ms.
 *
 * What exists here is one sensor, the owned Bitcoin Core node: its peers
 * from getpeerinfo, its capabilities from getnetworkinfo, DNS seeds resolved
 * on request, and a self-check that opens a real TCP connection. Geography
 * and ASN need a data source this deployment does not have and are reported
 * as absent, not guessed.
 */

export class GlobalNetworkUnavailableError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
}

export interface PeerInfo {
  id: number;
  addr: string;
  network?: string;
  services: string;
  servicesnames?: string[];
  relaytxes?: boolean;
  subver: string;
  startingheight: number;
  pingtime?: number;
  transport_protocol_type?: string;
  inbound?: boolean;
  version?: number;
  conntime?: number;
}

export interface NetworkInfo {
  version: number;
  protocolversion?: number;
  relayfee?: number;
  subversion: string;
  localservices: string;
  localservicesnames?: string[];
  connections: number;
  connections_in?: number;
  connections_out?: number;
  networks: { name: string; reachable: boolean }[];
}

export type NodeReader = () => Promise<{ peers: PeerInfo[]; info: NetworkInfo; genesisHash?: string }>;
export type SeedResolver = (hostname: string) => Promise<string[]>;
export type TcpProber = (address: string, port: number, timeoutMs: number) => Promise<{ reachable: boolean; latency_ms: number | null; error: string | null }>;

/** DNS seeds from Bitcoin Core chainparams for the configured network. */
export const DNS_SEEDS: Record<string, { hostname: string; maintainer: string }[]> = {
  mainnet: [
    { hostname: 'seed.bitcoin.sipa.be', maintainer: 'Pieter Wuille' }, { hostname: 'dnsseed.bluematt.me', maintainer: 'Matt Corallo' },
    { hostname: 'dnsseed.bitcoin.dashjr-list-of-p2p-nodes.us', maintainer: 'Luke Dashjr' }, { hostname: 'seed.bitcoin.jonasschnelli.ch', maintainer: 'Jonas Schnelli' },
    { hostname: 'seed.btc.petertodd.net', maintainer: 'Peter Todd' }, { hostname: 'seed.bitcoin.sprovoost.nl', maintainer: 'Sjors Provoost' },
    { hostname: 'dnsseed.emzy.de', maintainer: 'Stephan Oeste' }, { hostname: 'seed.bitcoin.wiz.biz', maintainer: 'Jason Maurice' },
    { hostname: 'seed.mainnet.achownodes.xyz', maintainer: 'Ava Chow' },
  ],
  testnet: [
    { hostname: 'testnet-seed.bitcoin.jonasschnelli.ch', maintainer: 'Jonas Schnelli' }, { hostname: 'seed.tbtc.petertodd.net', maintainer: 'Peter Todd' },
    { hostname: 'seed.testnet.bitcoin.sprovoost.nl', maintainer: 'Sjors Provoost' }, { hostname: 'testnet-seed.bluematt.me', maintainer: 'Matt Corallo' },
    { hostname: 'seed.testnet.achownodes.xyz', maintainer: 'Ava Chow' },
  ],
  testnet4: [{ hostname: 'seed.testnet4.bitcoin.sprovoost.nl', maintainer: 'Sjors Provoost' }, { hostname: 'seed.testnet4.wiz.biz', maintainer: 'Jason Maurice' }],
  signet: [{ hostname: 'seed.signet.bitcoin.sprovoost.nl', maintainer: 'Sjors Provoost' }, { hostname: 'seed.signet.achownodes.xyz', maintainer: 'Ava Chow' }],
};

const NODE_CACHE_MS = 30_000;
const SEED_CACHE_MS = 10 * 60_000;
const SELF_CHECK_TIMEOUT_MS = 5_000;

/** @asyncUnsafe The service turns a rejection into an unavailable state. */
const defaultNodeReader: NodeReader = async () => {
  const [peers, info, genesisHash] = await Promise.all([bitcoinClient.getPeerInfo() as Promise<PeerInfo[]>, bitcoinClient.getNetworkInfo() as Promise<NetworkInfo>, bitcoinClient.getBlockHash(0) as Promise<string>]);
  return { peers, info, genesisHash };
};

/** @asyncUnsafe The service records a rejection on the seed entry. */
const defaultSeedResolver: SeedResolver = async hostname => {
  const [v4, v6] = await Promise.all([dns.promises.resolve4(hostname).catch(() => [] as string[]), dns.promises.resolve6(hostname).catch(() => [] as string[])]);
  return [...v4, ...v6];
};

const defaultTcpProber: TcpProber = (address, port, timeoutMs) => new Promise(resolve => {
  const started = Date.now();
  const socket = net.connect({ host: address, port, timeout: timeoutMs });
  let settled = false;
  const finish = (result: { reachable: boolean; latency_ms: number | null; error: string | null }): void => { if (!settled) { settled = true; socket.destroy(); resolve(result); } };
  socket.on('connect', () => finish({ reachable: true, latency_ms: Date.now() - started, error: null }));
  socket.on('timeout', () => finish({ reachable: false, latency_ms: null, error: 'timeout' }));
  socket.on('error', error => finish({ reachable: false, latency_ms: null, error: (error as NodeJS.ErrnoException).code ?? error.message }));
});

function splitAddress(addr: string): { host: string; port: number } {
  const match = addr.match(/^\[?([^\]]+?)\]?:(\d+)$/);
  if (!match) { return { host: addr, port: 0 }; }
  return { host: match[1], port: Number(match[2]) };
}

export class GlobalNetworkService {
  private static instance: GlobalNetworkService;
  private cache: { at: number; peers: PeerInfo[]; info: NetworkInfo; genesisHash?: string } | null = null;
  private nodeFlight: Promise<{ peers: PeerInfo[]; info: NetworkInfo; genesisHash?: string }> | null = null;
  private nodeGeneration = 0;
  private seedCache = new Map<string, { at: number; addresses: string[]; error: string | null }>();
  private snapshots: GlobalNetworkSnapshot[] = [];
  private snapshotTimer: NodeJS.Timeout | null = null;

  public nodeReader: NodeReader = defaultNodeReader;
  public seedResolver: SeedResolver = defaultSeedResolver;
  public tcpProber: TcpProber = defaultTcpProber;

  private constructor() {}

  public static getInstance(): GlobalNetworkService {
    if (!GlobalNetworkService.instance) {
      GlobalNetworkService.instance = new GlobalNetworkService();
    }
    return GlobalNetworkService.instance;
  }

  /** Test seam. */
  public resetForTests(): void {
    this.cache = null;
    this.nodeFlight = null; this.nodeGeneration++;
    this.seedCache.clear();
    this.snapshots = [];
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  private async node(now = Date.now()): Promise<{ peers: PeerInfo[]; info: NetworkInfo; genesisHash?: string }> {
    if (this.cache && now >= this.cache.at && now - this.cache.at < NODE_CACHE_MS) return this.cache;
    if (this.nodeFlight) return this.waitNode(this.nodeFlight);
    const generation = this.nodeGeneration;
    const pending = (async () => {
      try {
        const fresh = await this.nodeReader();
        if (!Array.isArray(fresh.peers) || fresh.peers.length > 10000 || !fresh.info || !Array.isArray(fresh.info.networks)) throw new Error('Invalid owned node snapshot.');
        if (generation === this.nodeGeneration) this.cache = { at: now, ...fresh };
        return fresh;
      } catch (error) {
        throw new GlobalNetworkUnavailableError('node-unreachable', 'The owned node did not answer getpeerinfo/getnetworkinfo: ' + (error instanceof Error ? error.message : String(error)));
      }
    })();
    this.nodeFlight = pending;
    const settled = () => { if (this.nodeFlight === pending) this.nodeFlight = null; };
    void pending.then(settled, settled);
    return this.waitNode(pending);
  }

  private async waitNode<T>(pending: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try { return await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new GlobalNetworkUnavailableError('node-timeout', 'Owned Core observation exceeded 10 seconds.')), 10000); })]); }
    finally { if (timer) clearTimeout(timer); }
  }

  /** Shared owned Core observation; never relabel a different chain as this network. */
  public async getOwnedNodeSnapshot(now = Date.now()) {
    const snapshot = await this.node(now);
    const genesis: Record<string,string> = {
      mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
      signet: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
      testnet: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
      testnet4: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
      regtest: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
    };
    if (!snapshot.genesisHash || snapshot.genesisHash !== genesis[config.MEMPOOL.NETWORK]) throw new GlobalNetworkUnavailableError('node-network-mismatch', 'The owned Core genesis does not match the configured network.');
    const observed = this.cache?.at ?? now;
    return { ...snapshot, network: config.MEMPOOL.NETWORK, observed_at_utc: new Date(observed).toISOString(), age_ms: Math.max(0, now-observed), freshness_limit_ms: NODE_CACHE_MS };
  }

  private observation(peer: PeerInfo, epochId: string, at: number): GlobalNetworkObservation {
    const { host, port } = splitAddress(peer.addr);
    return {
      id: `peer-${peer.id}`, epoch_id: epochId, endpoint_id: peer.addr, ip_or_onion: host, port,
      services: Number.parseInt(peer.services, 16) || 0, user_agent: peer.subver, start_height: peer.startingheight,
      relay: peer.relaytxes ?? true, transport_v2: peer.transport_protocol_type === 'v2', addrv2: peer.version !== undefined ? peer.version >= 70016 : false,
      latency_ms: peer.pingtime !== undefined ? Math.round(peer.pingtime * 1000) : -1, country_code: undefined, asn: undefined,
      observed_at: new Date(at).toISOString(), inbound: peer.inbound ?? false, network: peer.network ?? 'unknown',
    };
  }

  private epoch(peers: PeerInfo[], at: number): GlobalNetworkCrawlEpoch {
    return {
      epoch_id: `peers-${config.MEMPOOL.NETWORK}-${Math.floor(at / NODE_CACHE_MS)}`, network: config.MEMPOOL.NETWORK, started_at: new Date(at).toISOString(), completed_at: new Date(at).toISOString(),
      discovered_nodes: peers.length, reachable_nodes: peers.length, v2_nodes: peers.filter(peer => peer.transport_protocol_type === 'v2').length, status: 'completed',
      scope: 'peers connected to the owned node; not a network crawl',
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getOverview(now = Date.now()): Promise<GlobalNetworkOverview> {
    const { peers, info } = await this.node(now);
    const agents = new Map<string, number>();
    const transports = new Map<string, number>();
    for (const peer of peers) {
      agents.set(peer.subver, (agents.get(peer.subver) ?? 0) + 1);
      const transport = peer.transport_protocol_type ?? 'v1';
      transports.set(transport, (transports.get(transport) ?? 0) + 1);
    }
    const total = peers.length;
    const pct = (part: number): number => total > 0 ? Math.round((part / total) * 10000) / 100 : 0;
    return {
      active_epoch: this.epoch(peers, this.cache?.at ?? now),
      sensors_count: 1,
      total_reachable_nodes: total,
      bip324_v2_adoption_percentage: pct(peers.filter(peer => peer.transport_protocol_type === 'v2').length),
      addrv2_adoption_percentage: pct(peers.filter(peer => (peer.version ?? 0) >= 70016).length),
      top_user_agents: [...agents.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([agent, count]) => ({ agent, count, percentage: pct(count) })),
      geographic_distribution: [],
      geo_source: null,
      transport_breakdown: [...transports.entries()].map(([transport, count]) => ({ transport, count })),
      node: { version: info.version, subversion: info.subversion, connections: info.connections, connections_in: info.connections_in ?? null, connections_out: info.connections_out ?? null, reachable_networks: info.networks.filter(n => n.reachable).map(n => n.name) },
      last_updated: new Date(this.cache?.at ?? now).toISOString(),
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getNodes(limit = 50, offset = 0, now = Date.now()): Promise<{ nodes: GlobalNetworkObservation[]; total: number }> {
    const { peers } = await this.node(now);
    const epochId = this.epoch(peers, this.cache?.at ?? now).epoch_id;
    const bounded = Math.max(1, Math.min(500, limit));
    const start = Math.max(0, offset);
    return { nodes: peers.slice(start, start + bounded).map(peer => this.observation(peer, epochId, this.cache?.at ?? now)), total: peers.length };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getNodeByEndpoint(endpointId: string, now = Date.now()): Promise<GlobalNetworkObservation | null> {
    const { peers } = await this.node(now);
    const peer = peers.find(entry => entry.addr === endpointId);
    return peer ? this.observation(peer, this.epoch(peers, this.cache?.at ?? now).epoch_id, this.cache?.at ?? now) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getDnsSeeds(now = Date.now()): Promise<GlobalNetworkDnsSeed[]> {
    const seeds = DNS_SEEDS[config.MEMPOOL.NETWORK] ?? [];
    const results: GlobalNetworkDnsSeed[] = [];
    for (const seed of seeds) {
      let entry = this.seedCache.get(seed.hostname);
      if (!entry || now - entry.at >= SEED_CACHE_MS) {
        try {
          entry = { at: now, addresses: await this.seedResolver(seed.hostname), error: null };
        } catch (error) {
          entry = { at: now, addresses: [], error: error instanceof Error ? error.message : String(error) };
        }
        this.seedCache.set(seed.hostname, entry);
      }
      results.push({
        seed_id: `seed-${seed.hostname}`, hostname: seed.hostname, maintainer: seed.maintainer, active: entry.addresses.length > 0,
        last_query_at: new Date(entry.at).toISOString(), discovered_addrs_count: entry.addresses.length,
        // Reachability of discovered addresses is not probed; that is a crawl this deployment does not run.
        reachable_ratio: null, error: entry.error,
      });
    }
    return results;
  }

  /** @asyncUnsafe A snapshot of the peer set, taken on the snapshot schedule. */
  public async takeSnapshot(blockHeight: number, now = Date.now()): Promise<GlobalNetworkSnapshot> {
    const { peers } = await this.node(now);
    const clients = new Map<string, number>();
    for (const peer of peers) { clients.set(peer.subver, (clients.get(peer.subver) ?? 0) + 1); }
    const snapshot: GlobalNetworkSnapshot = {
      snapshot_id: `snap-${config.MEMPOOL.NETWORK}-${now}`, network: config.MEMPOOL.NETWORK, block_height: blockHeight, timestamp_utc: new Date(now).toISOString(),
      total_nodes: peers.length, v2_percentage: peers.length ? Math.round((peers.filter(peer => peer.transport_protocol_type === 'v2').length / peers.length) * 10000) / 100 : 0,
      top_asns: [], top_clients: [...clients.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([client, count]) => ({ client, count })), geo_distribution: [],
      scope: 'peers connected to the owned node',
    };
    this.snapshots.unshift(snapshot);
    if (this.snapshots.length > 288) { this.snapshots.pop(); }
    return snapshot;
  }

  public startSnapshots(intervalMs = 10 * 60_000, height: () => number): void {
    if (this.snapshotTimer) { return; }
    this.snapshotTimer = setInterval(() => { this.takeSnapshot(height()).catch(error => logger.debug(`peer snapshot failed: ${error instanceof Error ? error.message : error}`)); }, intervalMs);
    this.snapshotTimer.unref?.();
  }

  public getSnapshots(): GlobalNetworkSnapshot[] {
    return this.snapshots;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getSensors(now = Date.now()): Promise<GlobalNetworkSensor[]> {
    const { info } = await this.node(now);
    return [{
      sensor_id: 'sensor-owned-node', region: 'Universe infrastructure', asn: undefined, software_version: info.subversion,
      status: 'active', v1_supported: true, v2_bip324_supported: info.version >= 260000, addrv2_bip155_supported: info.version >= 220000,
      last_probe_utc: new Date(this.cache?.at ?? now).toISOString(), reachable_networks: info.networks.filter(n => n.reachable).map(n => n.name),
    }];
  }

  public validateSelfCheckEndpoint(endpointAddress: string, port: number): { valid: boolean; error?: string } {
    if (!endpointAddress || typeof endpointAddress !== 'string' || endpointAddress.length > 253) {
      return { valid: false, error: 'Endpoint address is required.' };
    }
    if (!port || isNaN(port) || port < 1 || port > 65535) {
      return { valid: false, error: 'Port must be between 1 and 65535.' };
    }
    const trimmed = endpointAddress.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (trimmed === 'localhost' || trimmed.endsWith('.internal') || trimmed.endsWith('.local') || trimmed.endsWith('.localhost') || (net.isIP(trimmed) !== 0 && isPrivateAddress(trimmed))) {
      return { valid: false, error: 'Access to private, link-local, or loopback networks is prohibited.' };
    }
    if (!/^[a-z0-9.:-]+$/.test(trimmed)) {
      return { valid: false, error: 'Endpoint address must be a hostname or IP address.' };
    }
    return { valid: true };
  }

  /** @asyncUnsafe Opens one TCP connection from this deployment; nothing more is claimed. */
  public async performSelfCheck(req: GlobalNetworkSelfCheckRequest, now = Date.now()): Promise<GlobalNetworkSelfCheckResult> {
    const validation = this.validateSelfCheckEndpoint(req.endpoint_address, req.port);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid self check endpoint.');
    }
    const host = req.endpoint_address.trim().replace(/^\[|\]$/g, '');
    let pinned: { address: string; family: 4 | 6 };
    try {
      pinned = await resolvePublicAddress(new URL(`https://${net.isIP(host) === 6 ? `[${host}]` : host}/`));
    } catch (error) {
      throw new Error(error instanceof IdentityError ? error.message : 'Endpoint does not resolve to a public address.');
    }
    const probe = await this.tcpProber(pinned.address, req.port, SELF_CHECK_TIMEOUT_MS);
    return {
      check_id: 'chk-' + crypto.randomBytes(4).toString('hex'), endpoint_address: req.endpoint_address, port: req.port, resolved_address: pinned.address,
      probed_from_region: 'Universe infrastructure', reachable: probe.reachable, latency_ms: probe.latency_ms,
      // A TCP connect proves a listener; the Bitcoin handshake is not attempted here.
      bip324_handshake: null, user_agent: undefined, services: undefined, error: probe.error, probed_at: new Date(now).toISOString(),
    };
  }
}

export const globalNetworkService = GlobalNetworkService.getInstance();
