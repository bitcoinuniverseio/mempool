import { txGraphService } from './tx-graph.service';

describe('Product 6: Multi-Hop Transaction Graph Workspace', () => {
  const rootTx = 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f';

  it('performs bounded multi-hop graph expansion in both directions', () => {
    const result = txGraphService.queryGraph(rootTx, 2, 'both');
    expect(result.root_entity).toBe(rootTx);
    expect(result.hops).toBe(2);
    expect(result.nodes.length).toBeGreaterThanOrEqual(3);
    expect(result.edges.length).toBeGreaterThanOrEqual(2);
    expect(result.truncated).toBe(false);

    // Verify root is depth 0
    const rootNode = result.nodes.find((n) => n.id === rootTx);
    expect(rootNode).toBeDefined();
    expect(rootNode?.depth).toBe(0);
  });

  it('filters edges and nodes by minimum satoshi value threshold', () => {
    const resultAll = txGraphService.queryGraph(rootTx, 2, 'both', 0);
    const resultFiltered = txGraphService.queryGraph(rootTx, 2, 'both', 2000000);
    expect(resultFiltered.nodes.length).toBeLessThanOrEqual(resultAll.nodes.length);
    for (const node of resultFiltered.nodes) {
      expect(node.value_sats).toBeGreaterThanOrEqual(2000000);
    }
  });

  it('solves shortest deterministic value path between two entities', () => {
    const fromTx = 'tx-source-1111';
    const toTx = 'tx-target-2222';
    const pathResult = txGraphService.findShortestPath(fromTx, toTx);

    expect(pathResult.path_found).toBe(true);
    expect(pathResult.total_hops).toBe(2);
    expect(pathResult.node_sequence[0]).toBe(fromTx);
    expect(pathResult.node_sequence[pathResult.node_sequence.length - 1]).toBe(toTx);
    expect(pathResult.total_value_transferred_sats).toBeGreaterThan(0);
  });

  it('manages private investigation cases and creates revocable share links', () => {
    const saved = txGraphService.saveCase(
      'user-analyst-01',
      'Exchange Flow Investigation',
      rootTx,
      2,
      { min_value: 50000 },
      { zoom: 1.2 },
      'Tracing consolidation UTXOs.'
    );

    expect(saved.case_id).toBeDefined();
    expect(saved.is_shared).toBe(false);

    const userCases = txGraphService.getCases('user-analyst-01');
    expect(userCases.some((c) => c.case_id === saved.case_id)).toBe(true);

    // Enable sharing
    const updated = txGraphService.updateCase(saved.case_id, { is_shared: true });
    expect(updated?.is_shared).toBe(true);
    expect(updated?.share_token).toBeDefined();

    // Delete case
    const deleted = txGraphService.deleteCase(saved.case_id);
    expect(deleted).toBe(true);
    expect(txGraphService.getCaseById(saved.case_id)).toBeNull();
  });

  it('adheres to strict anti-heuristic rule: never clusters addresses without verified evidence', () => {
    const result = txGraphService.queryGraph(rootTx, 2, 'both');
    for (const node of result.nodes) {
      // Must not contain guessed entity clusters
      expect(node.label).not.toContain('cluster_heuristic');
      expect(node.evidence_tags).toEqual([]); // Empty unless explicit evidence claim attached
    }
  });
});
