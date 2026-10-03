import express from 'express';
import { Server } from 'http';
import { AddressInfo } from 'net';
import config from '../config';
import { ChainSourceIdentity, mountChainSourceIdentity } from '../api/bitcoin/chain-source-identity';
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));

const hash = (height: number) => (height === 0 ? '0' : '1').repeat(64);
const releaseSha = 'a'.repeat(40);
let info: any, calls: string[], reader: any, observer: ChainSourceIdentity;
const network = config.MEMPOOL.NETWORK, challenge = process.env.UNIVERSE_SIGNET_CHALLENGE;
beforeEach(() => {
  config.MEMPOOL.NETWORK = 'signet'; process.env.UNIVERSE_SIGNET_CHALLENGE = '51'; calls = [];
  info = { chain: 'signet', blocks: 10, bestblockhash: hash(10), signet_challenge: '51', initialblockdownload: false };
  reader = { selector: { backend: 'electrum', host: 'private-host', port: 123 }, tip: jest.fn(async () => 10), hash: jest.fn(async height => hash(height)) };
  observer = new ChainSourceIdentity({ index: () => reader, releaseSha: () => releaseSha,
    core: { rpc: { call: async (method, params) => { calls.push(method); return method === 'getblockchaininfo' ? { ...info } : hash(Number(params[0])); } } },
  }, 60);
});
afterAll(() => { config.MEMPOOL.NETWORK = network; if (challenge === undefined) delete process.env.UNIVERSE_SIGNET_CHALLENGE; else process.env.UNIVERSE_SIGNET_CHALLENGE = challenge; });

it('returns observed challenge/genesis/common checkpoint and exact artifact revision without source locations', async () => {
  const result = await observer.observe();
  expect(result).toMatchObject({ schema: 'universe-chain-source-identity-v1', chain: 'bitcoin', network: 'signet', genesisHash: hash(0), signetChallenge: '51', checkpoint: { heightAtomic: '10', blockHash: hash(10) }, releaseSha });
  expect(result.configurationSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(result)).not.toContain('private-host');
  expect(calls.filter(method => method === 'getblockchaininfo')).toHaveLength(2);
});
it.each([undefined, true, 'false'])('rejects missing or inexact node readiness %s', async ready => {
  info.initialblockdownload = ready;
  await expect(observer.observe()).rejects.toThrow('readiness');
  expect(reader.hash).not.toHaveBeenCalled();
});
it('rejects same-genesis fork and wrong challenge', async () => {
  reader.hash.mockImplementation(async height => height === 0 ? hash(0) : '2'.repeat(64));
  await expect(observer.observe()).rejects.toThrow('differs');
  info.signet_challenge = '52';
  await expect(observer.observe()).rejects.toThrow('challenge');
});
it('rejects missing full revision before source work', async () => {
  const missing = new ChainSourceIdentity({ index: () => reader, releaseSha: () => 'abcdef0', core: { rpc: { call: jest.fn() } } });
  await expect(missing.observe()).rejects.toThrow('revision'); expect(reader.tip).not.toHaveBeenCalled();
});
it('bounds hung index work and prevents new reads after its late response', async () => {
  let finish!: (value: number) => void;
  reader.tip.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await expect(observer.observe()).rejects.toThrow('deadline');
  finish(10); await new Promise<void>(resolve => setImmediate(resolve));
  expect(calls).toEqual([]); expect(reader.hash).not.toHaveBeenCalled();
});
it('reserves capacity before asynchronous source work and honors an already cancelled request', async () => {
  reader.tip.mockImplementation(() => new Promise(() => {}));
  const first = observer.observe().catch(error => error), second = observer.observe().catch(error => error);
  await expect(observer.observe()).rejects.toThrow('capacity');
  expect(reader.tip).toHaveBeenCalledTimes(2); await Promise.all([first, second]);
  const controller = new AbortController(); controller.abort();
  await expect(observer.observe(controller.signal)).rejects.toThrow('cancelled');
  expect(reader.tip).toHaveBeenCalledTimes(2);
});
it('mounts an anonymous read-only no-store endpoint with sanitized failures', async () => {
  const app = express(); mountChainSourceIdentity(app, observer);
  const server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    let response = await fetch(origin + config.MEMPOOL.API_URL_PREFIX + 'chain-source/identity');
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).releaseSha).toBe(releaseSha);
    reader.tip.mockRejectedValue(new Error('private-path-secret'));
    response = await fetch(origin + config.MEMPOOL.API_URL_PREFIX + 'chain-source/identity');
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'Configured chain source identity is unavailable' });
    expect((await fetch(origin + config.MEMPOOL.API_URL_PREFIX + 'chain-source/identity', { method: 'POST' })).status).toBe(404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
