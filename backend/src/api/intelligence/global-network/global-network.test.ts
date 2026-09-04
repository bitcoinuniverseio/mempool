import { globalNetworkService } from './global-network.service';

describe('GlobalNetworkService', () => {
  it('should return overview with valid active epoch and adoption metrics', () => {
    const overview = globalNetworkService.getOverview();
    expect(overview).toBeDefined();
    expect(overview.active_epoch).toBeDefined();
    expect(overview.total_reachable_nodes).toBeGreaterThan(0);
    expect(overview.bip324_v2_adoption_percentage).toBeGreaterThanOrEqual(0);
    expect(overview.top_user_agents.length).toBeGreaterThan(0);
    expect(overview.geographic_distribution.length).toBeGreaterThan(0);
  });

  it('should return paginated nodes', () => {
    const { nodes, total } = globalNetworkService.getNodes(2, 0);
    expect(nodes.length).toBeLessThanOrEqual(2);
    expect(total).toBeGreaterThan(0);
    expect(nodes[0].endpoint_id).toBeDefined();
  });

  it('should fetch node detail by endpoint ID', () => {
    const { nodes } = globalNetworkService.getNodes(1, 0);
    const node = globalNetworkService.getNodeByEndpoint(nodes[0].endpoint_id);
    expect(node).not.toBeNull();
    expect(node?.endpoint_id).toBe(nodes[0].endpoint_id);
  });

  it('should list DNS seeds with reachable metrics', () => {
    const seeds = globalNetworkService.getDnsSeeds();
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds[0].hostname).toBeDefined();
    expect(seeds[0].reachable_ratio).toBeGreaterThan(0);
  });

  it('should block SSRF attacks on self-check endpoint', () => {
    const ssrfTargets = [
      '127.0.0.1',
      'localhost',
      '10.0.1.5',
      '172.16.0.1',
      '192.168.1.100',
      '169.254.169.254',
      'node.internal',
    ];

    for (const target of ssrfTargets) {
      expect(() => {
        globalNetworkService.performSelfCheck({
          endpoint_address: target,
          port: 8333,
        });
      }).toThrow(/prohibited|invalid/i);
    }
  });

  it('should allow valid public endpoints on self-check', () => {
    const result = globalNetworkService.performSelfCheck({
      endpoint_address: '95.217.163.42',
      port: 8333,
    });
    expect(result.check_id).toBeDefined();
    expect(result.reachable).toBe(true);
    expect(result.bip324_handshake).toBe(true);
  });
});
