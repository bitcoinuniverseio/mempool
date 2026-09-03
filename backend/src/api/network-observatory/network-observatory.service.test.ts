import { networkObservatoryService } from './network-observatory.service';

describe('NetworkObservatoryService', () => {
  it('returns global observer node fleet with relay configurations', async () => {
    const nodes = await networkObservatoryService.$getNodes();
    expect(nodes.length).toBeGreaterThanOrEqual(4);
    const usNode = nodes.find((n) => n.id === 'node-us-east-01');
    expect(usNode).toBeDefined();
    expect(usNode?.status).toBe('online');
    expect(usNode?.fullRbf).toBe(true);
  });

  it('calculates cross-node transaction propagation latencies', async () => {
    const propagation = await networkObservatoryService.$getPropagation();
    expect(propagation.txid).toHaveLength(64);
    expect(propagation.nodeObservations.length).toBeGreaterThanOrEqual(4);
    expect(propagation.medianLatencyMs).toBeGreaterThan(0);
    expect(propagation.spreadDeltaMs).toBeGreaterThan(0);
  });

  it('returns candidate block template comparison', async () => {
    const templates = await networkObservatoryService.$getTemplates();
    expect(templates.blockHeight).toBeGreaterThan(800000);
    expect(templates.candidateTemplates.length).toBeGreaterThan(0);
    expect(templates.candidateTemplates[0].totalFeesSats).toBeDefined();
  });
});
