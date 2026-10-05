import { describe, expect, it } from 'vitest';
import { parseGlobalDetail, parseGlobalDns, parseGlobalNodes, parseGlobalOverview, parseGlobalSensors, parseGlobalSnapshots } from './global-network-observations';

// Controlled producer-shaped fixtures. These tests do not independently attest a live source.
const time = '2026-10-05T00:00:00.000Z';
const context = { chain_network: 'signet', genesis_hash: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  observed_at_utc: time, age_ms: 3, freshness_limit_ms: 30000, scope: 'Owned peer observation; not a network crawl.' };
const configured = { configured_network: 'signet', scope: 'Configured bounded records, not independent node identity.' };
const peer = { id: 'peer-1', epoch_id: 'owned-epoch', endpoint_id: 'example.org:38333', ip_or_onion: 'example.org',
  port: 38333, services: null, services_hex: null, user_agent: '/Satoshi:30.3.0/', start_height: 102,
  relay: null, transport_v2: null, addrv2: null, latency_ms: null, observed_at: time, inbound: null, network: 'onion' };
const seed = { seed_id: 'seed-1', hostname: 'seed.example.org', maintainer: 'chainparams', active: null,
  last_query_at: time, discovered_addrs_count: null, reachable_ratio: null, error: 'Controlled DNS unavailable' };
const snapshot = { snapshot_id: 'snapshot-1', network: 'testnet', block_height: 102, timestamp_utc: time,
  total_nodes: 1, v2_percentage: null, top_asns: [], top_clients: [{ client: '/Satoshi:30.3.0/', count: 1 }],
  geo_distribution: [], scope: 'Peers connected to the owned node' };
const sensor = { sensor_id: 'sensor-owned-node', region: 'Universe infrastructure', software_version: '/Satoshi:30.3.0/',
  status: 'active', v1_supported: true, v2_bip324_supported: null, addrv2_bip155_supported: null,
  last_probe_utc: time, reachable_networks: ['ipv4'] };
const overview = { active_epoch: { epoch_id: 'owned-epoch', network: 'signet', started_at: time, completed_at: time,
  discovered_nodes: 1, reachable_nodes: 1, v2_nodes: 0, status: 'completed', scope: 'Owned connected peers only' },
  sensors_count: 1, total_reachable_nodes: 1, bip324_v2_adoption_percentage: null, addrv2_adoption_percentage: null,
  top_user_agents: [{ agent: '/Satoshi:30.3.0/', count: 1, percentage: 100 }], geographic_distribution: [], geo_source: null,
  transport_breakdown: [{ transport: 'unknown', count: 1 }], node: { version: 300300, subversion: '/Satoshi:30.3.0/',
    connections: 1, connections_in: null, connections_out: null, reachable_networks: ['ipv4'] }, last_updated: time };

describe('Global reported observation boundaries', () => {
  it('keeps transport distinct from Bitcoin chain and preserves all nullable unmeasured peer facts', () => {
    const result = parseGlobalNodes({ ...context, nodes: [peer], total: 1 }, 'signet', 100, 0);
    expect(result.nodes[0].network).toBe('onion'); expect(result.nodes[0].transport_v2).toBeNull();
    expect(result.nodes[0].latency_ms).toBeNull(); expect(result.chain_network).toBe('signet');
    expect(parseGlobalDetail({ ...peer, ...context }, 'signet', peer.endpoint_id).services).toBeNull();
  });
  it.each([{ chain_network: 'mainnet' }, { genesis_hash: 'ab'.repeat(32) }, { observed_at_utc: '2026-02-30T00:00:00Z' },
    { age_ms: 30001 }, { age_ms: -1 }, { freshness_limit_ms: 0 }, { scope: '' }])('rejects foreign or invalid source/freshness metadata %j', change => {
    expect(() => parseGlobalNodes({ ...context, ...change, nodes: [], total: 0 }, 'signet', 100, 0)).toThrow();
  });
  it('rejects malformed peer facts, mismatched captured observation, duplicates and incomplete bounded pages', () => {
    for (const changed of [{ network: null }, { port: 65536 }, { transport_v2: 'unknown' }, { observed_at: '2026-10-04T00:00:00Z' }]) {
      expect(() => parseGlobalNodes({ ...context, nodes: [{ ...peer, ...changed }], total: 1 }, 'signet', 100, 0)).toThrow();
    }
    expect(() => parseGlobalNodes({ ...context, nodes: [peer, peer], total: 2 }, 'signet', 100, 0)).toThrow();
    expect(() => parseGlobalNodes({ ...context, nodes: [], total: 2 }, 'signet', 100, 0)).toThrow();
    expect(() => parseGlobalDetail({ ...peer, ...context }, 'signet', 'foreign.endpoint')).toThrow();
  });
  it('accepts empty exhausted pages and distinct peer identities sharing a transport endpoint', () => {
    expect(parseGlobalNodes({ ...context, nodes: [], total: 0 }, 'signet', 100, 0).nodes).toEqual([]);
    expect(parseGlobalNodes({ ...context, nodes: [], total: 100 }, 'signet', 100, 100).total).toBe(100);
    expect(parseGlobalNodes({ ...context, nodes: [peer, { ...peer, id: 'peer-2' }], total: 2 }, 'signet', 100, 0).nodes).toHaveLength(2);
  });
  it('retains genuine foreign-network snapshot records under a captured configured wrapper', () => {
    const result = parseGlobalSnapshots({ ...configured, snapshots: [snapshot], total: 1 }, 'signet');
    expect(result.snapshots[0].network).toBe('testnet'); expect(result.snapshots[0].v2_percentage).toBeNull();
    expect(parseGlobalSnapshots({ ...configured, snapshots: [], total: 0 }, 'signet').snapshots).toEqual([]);
    expect(() => parseGlobalSnapshots({ ...configured, configured_network: 'testnet4', snapshots: [snapshot], total: 1 }, 'signet')).toThrow();
    expect(() => parseGlobalSnapshots({ ...configured, snapshots: [{ ...snapshot, total_nodes: -1 }], total: 1 }, 'signet')).toThrow();
  });
  it('keeps DNS resolver failure and unprobed reachability unknown instead of fabricating a failed handshake', () => {
    const result = parseGlobalDns({ ...configured, seeds: [seed], total: 1 }, 'signet');
    expect(result.seeds[0].active).toBeNull(); expect(result.seeds[0].reachable_ratio).toBeNull();
    expect(() => parseGlobalDns({ ...configured, seeds: [seed], total: 2 }, 'signet')).toThrow();
    expect(() => parseGlobalDns({ ...configured, seeds: [{ ...seed, reachable_ratio: 2 }], total: 1 }, 'signet')).toThrow();
  });
  it('validates owned sensor capture and never turns unsupported addrv2 into false', () => {
    expect(parseGlobalSensors({ ...context, sensors: [sensor], total: 1 }, 'signet').sensors[0].addrv2_bip155_supported).toBeNull();
    expect(() => parseGlobalSensors({ ...context, sensors: [{ ...sensor, last_probe_utc: '2026-10-04T00:00:00Z' }], total: 1 }, 'signet')).toThrow();
    expect(() => parseGlobalSensors({ ...context, sensors: [sensor], total: 0 }, 'signet')).toThrow();
  });
  it('accepts bounded top-client lists without claiming every peer belongs to a displayed client', () => {
    expect(parseGlobalOverview(overview, 'signet').geo_source).toBeNull();
    const partial = { ...overview, total_reachable_nodes: 2, active_epoch: { ...overview.active_epoch, discovered_nodes: 2, reachable_nodes: 2 },
      transport_breakdown: [{ transport: 'unknown', count: 2 }], node: { ...overview.node, connections: 2 } };
    expect(parseGlobalOverview(partial, 'signet').top_user_agents).toHaveLength(1);
    expect(() => parseGlobalOverview({ ...overview, active_epoch: { ...overview.active_epoch, network: 'mainnet' } }, 'signet')).toThrow();
    expect(() => parseGlobalOverview({ ...overview, geographic_distribution: null }, 'signet')).toThrow();
    expect(() => parseGlobalOverview({ ...overview, bip324_v2_adoption_percentage: 101 }, 'signet')).toThrow();
  });
});
