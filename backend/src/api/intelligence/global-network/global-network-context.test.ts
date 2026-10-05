jest.mock('../../bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));

import express from 'express';
import { request, Server } from 'http';
import { AddressInfo } from 'net';
import config from '../../../config';
import routes from './global-network.routes';
import { globalNetworkService, NodeReader } from './global-network.service';

const signetGenesis = '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6';
const regtestGenesis = '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206';
const info = { version: 300300, subversion: '/Satoshi:30.3.0/', localservices: '0', connections: 0, networks: [] };

describe('mounted Global Network response context', () => {
  let server: Server;
  const originalNetwork = config.MEMPOOL.NETWORK;
  beforeEach(async () => {
    config.MEMPOOL.NETWORK = 'signet';
    globalNetworkService.resetForTests();
    globalNetworkService.nodeReader = jest.fn(async () => ({ peers: [], info, genesisHash: signetGenesis }));
    globalNetworkService.seedResolver = async () => [];
    const app = express(); routes.initRoutes(app);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    config.MEMPOOL.NETWORK = originalNetwork;
    globalNetworkService.resetForTests();
  });
  const get = (path: string): Promise<{ status: number; body: any }> => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port,
      path: '/api/v1/intelligence/network/global/' + path, agent: false }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', part => body += part);
      response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(body) }));
    }); req.on('error', reject); req.end();
  });

  it('keeps empty lists bound to their actual observation or explicitly configured selection', async () => {
    config.MEMPOOL.NETWORK = 'regtest';
    globalNetworkService.nodeReader = jest.fn(async () => ({ peers: [], info, genesisHash: regtestGenesis }));
    const nodes = await get('nodes?network=mainnet');
    expect(nodes).toMatchObject({ status: 200, body: { nodes: [], total: 0, chain_network: 'regtest', genesis_hash: regtestGenesis } });
    const sensors = await get('sensors');
    expect(sensors.body).toMatchObject({ chain_network: 'regtest', genesis_hash: regtestGenesis, total: 1 });
    expect(sensors.body.sensors).toHaveLength(1);
    for (const [route, field] of [['seeds', 'seeds'], ['snapshots', 'snapshots']]) {
      const response = await get(route);
      expect(response).toMatchObject({ status: 200, body: { configured_network: 'regtest', total: 0, [field]: [] } });
      expect(response.body.chain_network).toBeUndefined();
      expect(response.body.genesis_hash).toBeUndefined();
      expect(typeof response.body.scope).toBe('string');
    }
    expect(globalNetworkService.nodeReader).toHaveBeenCalledTimes(1);
  });

  it('preserves peer transport while reusing the same acquired native context for list, detail and sensor', async () => {
    globalNetworkService.nodeReader = jest.fn(async () => ({ info, genesisHash: signetGenesis, peers: [
      { id: 1, addr: 'abc.onion:38333', network: 'onion', services: '0', subver: '/Satoshi:30.3.0/', startingheight: 102 },
    ] }));
    const page = (await get('nodes')).body;
    const detail = (await get('nodes/abc.onion:38333')).body;
    const sensors = (await get('sensors')).body;
    expect(page.nodes[0].network).toBe('onion'); expect(detail.network).toBe('onion');
    for (const body of [page, detail, sensors]) {
      expect(body).toMatchObject({ chain_network: 'signet', genesis_hash: signetGenesis, freshness_limit_ms: 30000 });
      expect(body.observed_at_utc).toBe(page.observed_at_utc);
      expect(body.age_ms).toBeGreaterThanOrEqual(0);
    }
    expect(globalNetworkService.nodeReader).toHaveBeenCalledTimes(1);
  });

  it('refuses foreign native genesis before emitting any asserted observation context', async () => {
    globalNetworkService.nodeReader = async () => ({ peers: [], info, genesisHash: regtestGenesis });
    for (const path of ['nodes', 'sensors', 'nodes/not-present']) {
      const response = await get(path);
      expect(response).toMatchObject({ status: 503, body: { stage: 'node-network-mismatch' } });
      expect(response.body.chain_network).toBeUndefined();
    }
  });

  it('refuses a configured DNS context that changes while its real resolver attempt is pending', async () => {
    let finish!: (addresses: string[]) => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => started = resolve);
    globalNetworkService.seedResolver = () => { started(); return new Promise<string[]>(resolve => finish = resolve); };
    const response = get('seeds'); await pending;
    config.MEMPOOL.NETWORK = 'regtest';
    globalNetworkService.seedResolver = async () => [];
    finish([]);
    expect(await response).toMatchObject({ status: 503, body: { stage: 'configured-network-changed' } });
  });

  it('discloses each retained snapshot network without relabeling it or performing new native IO', async () => {
    const captured = await globalNetworkService.takeSnapshot(102);
    config.MEMPOOL.NETWORK = 'regtest';
    globalNetworkService.nodeReader = jest.fn(async () => { throw new Error('Unexpected native read'); });
    const response = await get('snapshots');
    expect(response).toMatchObject({ status: 200, body: { configured_network: 'regtest', total: 1 } });
    expect(response.body.snapshots).toEqual([captured]);
    expect(response.body.snapshots[0].network).toBe('signet');
    expect(globalNetworkService.nodeReader).not.toHaveBeenCalled();
    expect(globalNetworkService.getSnapshots()).toEqual([captured]);
  });

  it('retains the existing array service contracts for DNS seeds and sensors', async () => {
    expect(Array.isArray(await globalNetworkService.getDnsSeeds())).toBe(true);
    expect(Array.isArray(await globalNetworkService.getSensors())).toBe(true);
    expect(globalNetworkService.getSnapshots()).toEqual([]);
  });

  it('keeps an older in-flight acquisition timestamp when a later generation fills the cache', async () => {
    let finish!: (value: Awaited<ReturnType<NodeReader>>) => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => started = resolve);
    globalNetworkService.nodeReader = () => { started(); return new Promise(resolve => finish = resolve); };
    const first = globalNetworkService.getNodes(50, 0, 100000);
    await pending;
    globalNetworkService.resetForTests();
    globalNetworkService.nodeReader = async () => ({ peers: [], info, genesisHash: signetGenesis });
    const later = await globalNetworkService.getSensorsReport(200000);
    finish({ peers: [], info, genesisHash: signetGenesis });
    const earlier = await first;
    expect(earlier.observed_at_utc).toBe(new Date(100000).toISOString());
    expect(later.observed_at_utc).toBe(new Date(200000).toISOString());
    expect((await globalNetworkService.getSensorsReport(200001)).observed_at_utc).toBe(later.observed_at_utc);
  });

  it('refuses native acquisition when configured context changes before its response arrives', async () => {
    let finish!: (value: Awaited<ReturnType<NodeReader>>) => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => started = resolve);
    globalNetworkService.nodeReader = () => { started(); return new Promise(resolve => finish = resolve); };
    const response = get('nodes'); await pending;
    config.MEMPOOL.NETWORK = 'regtest';
    finish({ peers: [], info, genesisHash: regtestGenesis });
    expect(await response).toMatchObject({ status: 503, body: { stage: 'configured-network-changed' } });
  });

  it.each(['overview', 'snapshot'])('keeps %s bound to its captured observation when another generation fills the cache', async family => {
    let finish!: (value: Awaited<ReturnType<NodeReader>>) => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => started = resolve);
    globalNetworkService.nodeReader = () => { started(); return new Promise(resolve => finish = resolve); };
    const first = family === 'overview' ? globalNetworkService.getOverview(100000) : globalNetworkService.takeSnapshot(73, 100000);
    await pending;
    globalNetworkService.resetForTests();
    globalNetworkService.nodeReader = async () => ({ peers: [], info, genesisHash: signetGenesis });
    await globalNetworkService.getSensorsReport(200000);
    finish({ peers: [], info, genesisHash: signetGenesis });
    const earlier = await first;
    if (family === 'overview') {
      expect(earlier).toMatchObject({ last_updated: new Date(100000).toISOString(), active_epoch: { network: 'signet', started_at: new Date(100000).toISOString() } });
    } else {
      expect(earlier).toMatchObject({ network: 'signet', timestamp_utc: new Date(100000).toISOString(), block_height: 73 });
    }
  });
});
