import express from 'express';
import { Server } from 'http';
import { StratumV2Service, stratumV2Service } from './stratum-v2.service';
import { sv2Fixture } from './stratum-v2.fixture';
import { Sv2Acquisition, Sv2Snapshot } from './stratum-v2.native-types';
import routes from './stratum-v2.routes';

const acquired = (snapshot: Sv2Snapshot): Sv2Acquisition => ({ snapshot, bytes: 4000, rawSha256: 'a'.repeat(64) });
describe('SV2 source-bound retained observation pagination', () => {
  let now: number, body: Sv2Snapshot, read: jest.Mock, service: StratumV2Service;
  beforeEach(() => {
    now = Date.now(); body = sv2Fixture(now); read = jest.fn(async () => acquired(JSON.parse(JSON.stringify(body))));
    service = new StratumV2Service(() => ({ read }), () => now);
  });
  it('captures immutable pages, rereads source for retries, and never invents total coinbase or mining state', async () => {
    const first = await service.$getPage<any>('templates', { limit: '1' });
    expect(first.items[0]).toMatchObject({ coinbaseValueRemainingSats: '5000000000', coinbaseTxValueSats: null, poolSelectedTxCount: null, generatedAt: null, status: 'observed-current' });
    expect(first.completeHistory).toBe(false); expect(first.totalScope).toBe('captured-retained-observations');
    body.sourceGenerationAtomic = '2'; body.links.push({ ...body.links[0], templateIdAtomic: '99' });
    const second = await service.$getPage<any>('templates', { limit: '1', cursor: first.nextCursor });
    const retry = await service.$getPage<any>('templates', { limit: '1', cursor: first.nextCursor });
    expect(second.items).toEqual(retry.items); expect(second.total).toBe(3); expect(second.source.sourceGenerationAtomic).toBe('1'); expect(read).toHaveBeenCalledTimes(3);
  });
  it.each(['epoch', 'checkpoint', 'profile'])('rejects changed %s rather than mixing observation pages', async field => {
    const first = await service.$getPage('declarations', { limit: '1' });
    if (field === 'epoch') body.sourceEpoch = '2715e618-19df-4ea3-9fd5-49c69a1977e9';
    if (field === 'checkpoint') body.core.checkpoint.blockHash = 'b'.repeat(64);
    if (field === 'profile') body.profileSha256 = 'b'.repeat(64);
    await expect(service.$getPage('declarations', { cursor: first.nextCursor })).rejects.toMatchObject({ status: 409 });
  });
  it('rejects generation rollback on fresh and continued reads against latest same-epoch observation', async () => {
    const first = await service.$getPage('declarations', { limit: '1' }); body.sourceGenerationAtomic = '10';
    await service.$getPage('roles'); body.sourceGenerationAtomic = '9';
    await expect(service.$getPage('roles')).rejects.toMatchObject({ code: 'sv2-generation-regressed', status: 503 });
    await expect(service.$getPage('declarations', { cursor: first.nextCursor })).rejects.toMatchObject({ status: 503 });
  });
  it('releases unpaged and fully consumed captures instead of exhausting ordinary read capacity', async () => {
    for (let index = 0; index < 12; index++) await expect(service.$getPage('roles')).resolves.toMatchObject({ nextCursor: null });
    const first = await service.$getPage('declarations', { limit: '1' });
    const final = await service.$getPage('declarations', { limit: '100', cursor: first.nextCursor });
    expect(final.nextCursor).toBeNull(); await expect(service.$getPage('declarations', { cursor: first.nextCursor })).rejects.toMatchObject({ status: 409 });
  });
  it('does not answer cached retries on outage, wrong network, expiry or backend restart', async () => {
    const first = await service.$getPage('declarations', { limit: '1' });
    read.mockRejectedValueOnce(new Error('source unavailable')); await expect(service.$getPage('declarations', { cursor: first.nextCursor })).rejects.toThrow('source unavailable');
    await expect(service.$getPage('declarations', { network: 'signet', cursor: first.nextCursor })).rejects.toMatchObject({ status: 400 });
    now += 30000; await expect(service.$getPage('declarations', { cursor: first.nextCursor })).rejects.toMatchObject({ status: 409 });
    const restarted = new StratumV2Service(() => ({ read })); await expect(restarted.$getPage('declarations', { cursor: first.nextCursor })).rejects.toMatchObject({ status: 400 });
  });
  it.each([{ limit: ['1', '2'] }, { limit: '101' }, { limit: '0' }, { limit: '1.5' }, { network: { signet: true } }, { cursor: '' }, { cursor: 'bad' }])('rejects non-scalar or malformed selectors before IO: %j', async query => {
    await expect(service.$getPage('roles', query)).rejects.toMatchObject({ status: 400 }); expect(read).not.toHaveBeenCalled();
  });
  it('bounds concurrent source acquisition before IO and releases cancellation reservations', async () => {
    const release: (() => void)[] = [];
    read.mockImplementation(() => new Promise<Sv2Acquisition>(resolve => release.push(() => resolve(acquired(body)))));
    const controller = new AbortController();
    const reads = Array.from({ length: 8 }, () => service.$getPage('templates', {}, controller.signal));
    await expect(service.$getPage('templates')).rejects.toMatchObject({ status: 429 }); expect(read).toHaveBeenCalledTimes(8);
    controller.abort(); release.forEach(done => done()); await expect(Promise.all(reads)).rejects.toMatchObject({ status: 504 });
    read.mockResolvedValue(acquired(body)); await expect(service.$getPage('templates')).resolves.toMatchObject({ total: 3 });
  });
  it('rejects oversized raw captures and does not claim unverified old work superseded', async () => {
    read.mockResolvedValueOnce({ ...acquired(body), bytes: 1048577 }); await expect(service.$getPage('templates')).rejects.toMatchObject({ status: 429 });
    body.links[0].prevHashLE = 'b'.repeat(64); const page = await service.$getPage<any>('templates'); expect(page.items[0].status).toBe('unverified-history');
  });
});

describe('actual registered SV2 HTTP boundaries', () => {
  let server: Server, origin: string;
  beforeEach(async () => {
    const app = express(); routes.initRoutes(app); server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve)); origin = `http://127.0.0.1:${(server.address() as any).port}/api/v1/stratum-v2/`;
  });
  afterEach(async () => { jest.restoreAllMocks(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  it('rejects unknown query keys before service IO', async () => {
    const read = jest.spyOn(stratumV2Service, '$getPage'); const response = await fetch(origin + 'templates?origin=http://foreign');
    expect(response.status).toBe(400); expect(read).not.toHaveBeenCalled();
  });
  it('mounts exact source-aware response families with no-store', async () => {
    const native = new StratumV2Service(() => ({ read: async () => acquired(sv2Fixture()) }));
    jest.spyOn(stratumV2Service, '$getPage').mockImplementation((family, query, signal) => native.$getPage(family, query, signal));
    for (const [path, family] of [['network', 'roles'], ['templates', 'templates'], ['declarations', 'declarations']]) {
      const response = await fetch(origin + path + '?network=regtest&limit=1'), body = await response.json();
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(body[family]).toHaveLength(1);
      expect(body.source.profile.network).toBe('regtest'); expect(body.completeHistory).toBe(false);
    }
  });
});
