jest.mock('../bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));
jest.mock('../mempool-blocks', () => ({ __esModule: true, default: { getMempoolBlocksWithTransactions: () => [] } }));

import { Application, Request, Response } from 'express';
import config from '../../config';
import { RelayCollectorService } from '../intelligence/relay/relay-collector.service';
import { templateCollectorService } from '../intelligence/templates/template-collector.service';
import networkObservatoryRoutes from './network-observatory.routes';
import { NetworkObservatoryEvidenceError, NetworkObservatoryService, ObservatoryReaders } from './network-observatory.service';

const TX = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);

/**
 * The collectors are the real ones with their sources stubbed: a relay
 * collector fed poll deltas, and the template collector fed getblocktemplate
 * answers. Nothing here invents a second observer.
 */
function setup(local: string[] | null = [TX]) {
  let now = 100_000;
  const snapshot = jest.fn(async () => ({
    network: config.MEMPOOL.NETWORK, observed_at_utc: new Date(now).toISOString(), age_ms: 0, freshness_limit_ms: 30000,
    peers: [{ addr: '192.0.2.1:8333', id: 4, transport_protocol_type: 'v2' }, { addr: '192.0.2.2:8333', id: 5, transport_protocol_type: 'v1' }],
    info: { subversion: '/Satoshi:30.0.0/', protocolversion: 70016, relayfee: 0.00001, networks: [] },
  } as any));
  const relay = new RelayCollectorService({ now: () => now, snapshotReader: snapshot, policyReader: async () => ({ fullrbf: true }) });
  templateCollectorService.resetForTests();
  templateCollectorService.readProjection = () => null;
  const readers: ObservatoryReaders = { relay, templates: templateCollectorService, localMempoolTxids: () => (local ? new Set(local) : null) };
  const service = new NetworkObservatoryService(readers);
  return { service, relay, snapshot, setNow: (value: number) => { now = value; }, now: () => now };
}

describe('NetworkObservatoryService', () => {
  it('reports the single owned observer as one node with unmeasured dimensions unknown', async () => {
    const { service, relay } = setup();
    relay.observeMempoolPoll([{ txid: TX }], [], true, 100_000);
    const nodes = await service.$getNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: expect.stringContaining('owned-mempool-poller-'), region: 'unknown', clientVersion: '/Satoshi:30.0.0/', protocolVersion: 70016, fullRbf: true,
      minRelayFeeRate: 1, clockOffsetMs: null, connectedPeers: 2, mempoolTxCount: 1, status: 'online', network: config.MEMPOOL.NETWORK, policySourceAvailable: true,
    });
    expect(nodes[0].scope).toMatch(/One observer/);
    expect(JSON.stringify(nodes)).not.toMatch(/192\.0\.2/);
  });

  it('marks the observer degraded when its polls are stale and reports the owned node outage as unavailable', async () => {
    const { service, relay, snapshot, setNow } = setup();
    relay.observeMempoolPoll([], [], true, 100_000);
    setNow(140_000);
    expect((await service.$getNodes())[0].status).toBe('degraded');
    snapshot.mockRejectedValueOnce(new Error('node unavailable'));
    await expect(service.$getNodes()).rejects.toMatchObject({ code: 'owned-node-unavailable', status: 503 });
    snapshot.mockRejectedValueOnce(new Error('node unavailable'));
    await expect(service.$getPropagation(TX)).rejects.toBeInstanceOf(NetworkObservatoryEvidenceError);
  });

  it('returns a transaction\'s recorded lifecycle from the one observer, with observer identity, clock uncertainty and retention', async () => {
    const { service, relay, setNow } = setup();
    relay.observeMempoolPoll([], [], true, 100_000);
    relay.observeMempoolPoll([{ txid: TX }], [], true, 101_000);
    relay.observeMempoolPoll([], [{ txid: TX }], true, 103_000);
    setNow(103_000);
    const propagation = await service.$getPropagation(TX);
    expect(propagation).toMatchObject({
      txid: TX, state: 'observed', network: config.MEMPOOL.NETWORK, firstSeenTimestamp: 101_000, lastSeenTimestamp: 103_000,
      medianLatencyMs: null, p95LatencyMs: null, spreadDeltaMs: null,
      observer: { observers: 1, clockOffsetMs: null, clockUncertaintyMs: null },
      window: { collection: 'observing', retainedTransactions: 1, lastCompletePollUtc: new Date(103_000).toISOString() },
    });
    expect(propagation.nodeObservations).toEqual([
      expect.objectContaining({ arrivedAt: 101_000, deltaFromFirstMs: 0, accepted: true, presence: 'present', previousCompletePollUtc: new Date(100_000).toISOString() }),
      expect.objectContaining({ arrivedAt: 103_000, deltaFromFirstMs: 2_000, accepted: false, presence: 'left_mempool' }),
    ]);
    expect(new Set(propagation.nodeObservations.map(o => o.nodeId)).size).toBe(1);
    expect(propagation.expiresAtUtc).toBe(new Date(103_000 + 24 * 60 * 60 * 1000).toISOString());
  });

  it('answers an unobserved transaction and an empty observer with explicit states rather than a timeline', async () => {
    const { service, relay } = setup();
    const empty = await service.$getPropagation();
    expect(empty).toMatchObject({ txid: null, state: 'no-observations', nodeObservations: [], window: { collection: 'not_started' } });
    relay.observeMempoolPoll([{ txid: OTHER }], [], true, 100_000);
    const unknown = await service.$getPropagation(TX);
    expect(unknown).toMatchObject({ txid: TX, state: 'not-observed', nodeObservations: [], firstSeenTimestamp: null });
    const latest = await service.$getPropagation();
    expect(latest).toMatchObject({ txid: OTHER, state: 'observed' });
    await expect(service.$getPropagation('not-a-txid')).rejects.toMatchObject({ code: 'invalid-txid', status: 400 });
  });

  it('compares the recorded candidate templates for the latest height with each other and the local mempool', async () => {
    const { service } = setup([TX]);
    templateCollectorService.fetchCoreTemplate = async () => ({ height: 100, previousblockhash: 'p'.repeat(64), transactions: [{ txid: TX, hash: TX, fee: 100, weight: 400 }, { txid: OTHER, hash: OTHER, fee: 50, weight: 400 }], coinbasevalue: 5000 });
    await templateCollectorService.collectCoreTemplate(1_000);
    templateCollectorService.readProjection = () => ({ transactionIds: [TX], totalFees: 100, blockVSize: 100, nTx: 1 });
    templateCollectorService.collectProjection(2_000);
    const comparison = await service.$getTemplates();
    expect(comparison).toMatchObject({ state: 'observed', blockHeight: 100, generatedAt: 2_000, consensusMempoolTxCount: 1, missingFromLocalCount: 1, feeRateSpreadSatVb: null, observer: { observers: 1 } });
    expect(comparison.candidateTemplates).toHaveLength(2);
    const core = comparison.candidateTemplates.find(t => t.sourceType === 'core_gbt')!;
    expect(core).toMatchObject({ poolName: 'Bitcoin Core getblocktemplate', txCount: 2, totalFeesSats: '150', uniqueTxids: [OTHER], missingFromLocalMempool: 1, expectedMedianFeeRate: null });
    const projection = comparison.candidateTemplates.find(t => t.sourceType === 'mempool_projection')!;
    expect(projection).toMatchObject({ txCount: 1, uniqueTxids: [], missingFromLocalMempool: 0 });
    expect(comparison.sources.map(s => s.status)).toEqual(['active', 'active']);
  });

  it('reports no templates observed with the sources\' own status instead of an empty list of pools', async () => {
    const { service } = setup(null);
    templateCollectorService.fetchCoreTemplate = async () => { throw new Error('rpc offline'); };
    await templateCollectorService.collectCoreTemplate(1_000);
    const comparison = await service.$getTemplates();
    expect(comparison).toMatchObject({ state: 'no-templates-observed', blockHeight: null, candidateTemplates: [], consensusMempoolTxCount: null, missingFromLocalCount: null });
    expect(comparison.sources.find(s => s.sourceId === 'src-core-gbt')).toMatchObject({ status: 'offline', lastError: 'rpc offline' });
  });
});

describe('Network observatory HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): Map<string, Handler> {
    const gets = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
    };
    networkObservatoryRoutes.initRoutes(app as unknown as Application);
    return gets;
  }

  it('mounts the four routes and maps a source outage to a 503 that names it', async () => {
    const gets = mount();
    expect([...gets.keys()]).toEqual([
      config.MEMPOOL.API_URL_PREFIX + 'network/nodes',
      config.MEMPOOL.API_URL_PREFIX + 'network/propagation',
      config.MEMPOOL.API_URL_PREFIX + 'network/propagation/:txid',
      config.MEMPOOL.API_URL_PREFIX + 'network/templates',
    ]);
    // The default service reads the process-wide relay collector, whose owned node is not reachable in a unit test.
    for (const path of [config.MEMPOOL.API_URL_PREFIX + 'network/nodes', config.MEMPOOL.API_URL_PREFIX + 'network/propagation/:txid']) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await gets.get(path)!({ params: { txid: TX } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/owned-node-unavailable|unavailable/);
      expect(body).not.toHaveProperty('nodes');
      expect(body).not.toHaveProperty('nodeObservations');
    }
  });
});
