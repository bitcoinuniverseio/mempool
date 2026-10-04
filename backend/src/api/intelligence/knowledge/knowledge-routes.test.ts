import express from 'express';
import { request, Server } from 'http';
import { AddressInfo } from 'net';

jest.mock('../../../config', () => ({ __esModule: true, default: { MEMPOOL: { NETWORK: 'signet' } } }));
jest.mock('./knowledge-registry.service', () => ({ knowledgeRegistryService: { getLabels: jest.fn(), getAuditLog: jest.fn() } }));
jest.mock('../identity/owner-auth', () => ({ requireOwner: jest.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()), ownerOf: jest.fn(), sendIdentityError: jest.fn() }));
import config from '../../../config';
import routes from './knowledge.routes';
import { knowledgeRegistryService } from './knowledge-registry.service';

describe('mounted public Knowledge response context', () => {
  let server: Server;
  const labels = [{ label_id: 'pool-public', source: 'pools_definition', category: 'mining_pool', evidence: [] }];
  const events = [{ audit_id: 'audit-one', label_id: 'submitted-one', action: 'created', actor_id: 'owner-one' }];
  beforeAll(async () => {
    const app = express(); routes.initRoutes(app);
    server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  beforeEach(() => {
    jest.clearAllMocks(); config.MEMPOOL.NETWORK = 'signet';
    (knowledgeRegistryService.getLabels as jest.Mock).mockResolvedValue(labels);
    (knowledgeRegistryService.getAuditLog as jest.Mock).mockResolvedValue(events);
  });
  const get = (path: string): Promise<{ status: number; body: any }> => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path: '/api/v1/intelligence/knowledge/' + path, agent: false }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => { try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (error) { reject(error); } });
    }); req.on('error', reject); req.end();
  });
  it('publishes labels schema and selected network without altering pool evidence or category', async () => {
    expect(await get('labels?category=mining_pool')).toEqual({ status: 200, body: { schema: 'universe-knowledge-labels-v1', network: 'signet', labels, count: 1 } });
    expect(knowledgeRegistryService.getLabels).toHaveBeenCalledWith('mining_pool');
  });
  it('publishes audit schema and configured network preserving exact events/count', async () => {
    config.MEMPOOL.NETWORK = 'testnet';
    expect(await get('audit-log')).toEqual({ status: 200, body: { schema: 'universe-knowledge-audit-v1', network: 'testnet', audit_events: events, count: 1 } });
    expect(knowledgeRegistryService.getAuditLog).toHaveBeenCalledWith();
  });
  it('does not relabel configured context from an ungoverned query selector', async () => {
    expect((await get('labels?network=mainnet')).body).toMatchObject({ schema: 'universe-knowledge-labels-v1', network: 'signet', labels, count: 1 });
    expect((await get('audit-log?network=mainnet')).body).toMatchObject({ schema: 'universe-knowledge-audit-v1', network: 'signet', audit_events: events, count: 1 });
    expect(knowledgeRegistryService.getLabels).toHaveBeenCalledWith(undefined);
  });
});
