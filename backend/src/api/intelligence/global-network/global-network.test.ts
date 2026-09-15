jest.mock('../../bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));

import { globalNetworkService, GlobalNetworkUnavailableError, DNS_SEEDS } from './global-network.service';
import config from '../../../config';

const peers = [
  { id: 1, addr: '203.0.113.10:8333', network: 'ipv4', services: '0000000000000409', subver: '/Satoshi:28.0.0/', startingheight: 100, pingtime: 0.032, transport_protocol_type: 'v2', inbound: false, version: 70016, relaytxes: true },
  { id: 2, addr: '[2001:db8::5]:8333', network: 'ipv6', services: '0000000000000409', subver: '/Satoshi:27.1.0/', startingheight: 99, pingtime: 0.07, transport_protocol_type: 'v1', inbound: true, version: 70015, relaytxes: true },
  { id: 3, addr: 'abc.onion:8333', network: 'onion', services: '0000000000000409', subver: '/Satoshi:28.0.0/', startingheight: 100, transport_protocol_type: 'v2', inbound: true, version: 70016, relaytxes: false },
];
const info = { version: 280000, subversion: '/Satoshi:28.0.0/', localservices: '0409', connections: 3, connections_in: 2, connections_out: 1, networks: [{ name: 'ipv4', reachable: true }, { name: 'ipv6', reachable: true }, { name: 'onion', reachable: false }] };

describe('global network: the owned node is the only sensor', () => {
  beforeEach(() => {
    globalNetworkService.resetForTests();
    globalNetworkService.nodeReader = async () => ({ peers: peers as never, info });
  });

  it('overview counts the real peers and claims no geography', async () => {
    const overview = await globalNetworkService.getOverview();
    expect(overview.total_reachable_nodes).toBe(3);
    expect(overview.bip324_v2_adoption_percentage).toBe(66.67);
    expect(overview.addrv2_adoption_percentage).toBe(66.67);
    expect(overview.top_user_agents).toEqual([{ agent: '/Satoshi:28.0.0/', count: 2, percentage: 66.67 }, { agent: '/Satoshi:27.1.0/', count: 1, percentage: 33.33 }]);
    expect(overview.geographic_distribution).toEqual([]);
    expect(overview.geo_source).toBeNull();
    expect(overview.active_epoch.scope).toMatch(/not a network crawl/);
    expect(overview.node).toMatchObject({ version: 280000, connections: 3, reachable_networks: ['ipv4', 'ipv6'] });
  });

  it('nodes are the peers, paginated, and lookups are by peer address', async () => {
    const page = await globalNetworkService.getNodes(2, 1);
    expect(page.total).toBe(3);
    expect(page.nodes.map(n => n.endpoint_id)).toEqual(['[2001:db8::5]:8333', 'abc.onion:8333']);
    expect(page.nodes[0]).toMatchObject({ ip_or_onion: '2001:db8::5', port: 8333, transport_v2: false, addrv2: false, latency_ms: 70, inbound: true, network: 'ipv6' });
    expect(page.nodes[1].latency_ms).toBe(-1);
    expect(await globalNetworkService.getNodeByEndpoint('203.0.113.10:8333')).toMatchObject({ user_agent: '/Satoshi:28.0.0/', transport_v2: true });
    expect(await globalNetworkService.getNodeByEndpoint('nobody:1')).toBeNull();
  });

  it('an unreachable node is unavailable, not a sample network', async () => {
    globalNetworkService.nodeReader = async () => { throw new Error('401 Unauthorized'); };
    await expect(globalNetworkService.getOverview()).rejects.toThrow(GlobalNetworkUnavailableError);
    await expect(globalNetworkService.getSensors()).rejects.toThrow(/401/);
  });

  it('DNS seeds are resolved on request and report what came back', async () => {
    globalNetworkService.seedResolver = async hostname => hostname.includes('sprovoost') ? ['203.0.113.1', '203.0.113.2'] : [];
    const seeds = await globalNetworkService.getDnsSeeds();
    expect(seeds.map(s => s.hostname)).toEqual(DNS_SEEDS[config.MEMPOOL.NETWORK].map(s => s.hostname));
    const sprovoost = seeds.find(s => s.hostname.includes('sprovoost'))!;
    expect(sprovoost).toMatchObject({ active: true, discovered_addrs_count: 2, reachable_ratio: null, error: null });
    expect(seeds.filter(s => !s.hostname.includes('sprovoost')).every(s => s.active === false && s.discovered_addrs_count === 0)).toBe(true);
  });

  it('a snapshot records the peer set at a height', async () => {
    const snapshot = await globalNetworkService.takeSnapshot(500);
    expect(snapshot).toMatchObject({ block_height: 500, total_nodes: 3, v2_percentage: 66.67, top_asns: [], geo_distribution: [] });
    expect(globalNetworkService.getSnapshots()).toHaveLength(1);
  });

  it('self-check refuses private targets and reports the real TCP outcome', async () => {
    for (const address of ['127.0.0.1', '10.1.1.1', 'localhost', '169.254.169.254', 'fd00::1']) {
      expect(globalNetworkService.validateSelfCheckEndpoint(address, 8333).valid).toBe(false);
    }
    expect(globalNetworkService.validateSelfCheckEndpoint('203.0.113.7', 70000).valid).toBe(false);
    globalNetworkService.tcpProber = async (address, port) => ({ reachable: port === 8333, latency_ms: port === 8333 ? 41 : null, error: port === 8333 ? null : 'ECONNREFUSED' });
    const ok = await globalNetworkService.performSelfCheck({ endpoint_address: '203.0.113.7', port: 8333 });
    expect(ok).toMatchObject({ reachable: true, latency_ms: 41, bip324_handshake: null, resolved_address: '203.0.113.7', error: null });
    const refused = await globalNetworkService.performSelfCheck({ endpoint_address: '203.0.113.7', port: 8334 });
    expect(refused).toMatchObject({ reachable: false, latency_ms: null, error: 'ECONNREFUSED' });
  });
});
