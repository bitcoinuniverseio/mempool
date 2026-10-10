import http from 'http';
import { AddressHttpReader, verifyAddressHttpSource } from '../api/bitcoin/address-http-reader';
import { verifyAddressSource } from '../api/bitcoin/address-source-checkpoint';
import { AddressReadPhase } from '../api/bitcoin/address-read-diagnostic';
import { AddressReadAdmission } from '../api/bitcoin/address-read-admission';
jest.mock('../logger', () => ({ __esModule: true, default: { warn: jest.fn() } }));
jest.mock('../config', () => ({ __esModule: true, default: { MEMPOOL: { NETWORK: 'signet' } } }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ addressBitcoinClient: {} }));
const hash = (n: number) => n.toString(16).padStart(64, '0');
const stats = () => ({ funded_txo_count: 13500, funded_txo_sum: 1400000000000, spent_txo_count: 1100, spent_txo_sum: 190000000000, tx_count: 13500 });
const address = 'tb1pqualification';
const summary = () => ({ address, chain_stats: stats(), mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 } });
const transaction = (n: number) => ({ txid: hash(n), vin: [{ prevout: { value: 1000 } }], vout: [{ value: 900 }], fee: 100, weight: 400,
  status: { confirmed: true, block_height: 20, block_hash: hash(20), block_time: 1000 } });
let server: http.Server, origin: string, paths: string[], mode: string, summaries: number, histories: number;
let core: { rpc: { call: jest.Mock } };
beforeEach(async () => {
  process.env.UNIVERSE_SIGNET_CHALLENGE = '51'; paths = []; mode = ''; summaries = 0; histories = 0;
  core = { rpc: { call: jest.fn(async (method, params) => method === 'getblockchaininfo'
    ? { chain: 'signet', blocks: 20, bestblockhash: hash(20), signet_challenge: '51' } : hash(params[0])) } };
  server = http.createServer((req, res) => {
    const path = req.url!; paths.push(path);
    if (mode === 'timeout') return;
    if (mode === 'redirect') { res.writeHead(302, { Location: origin + '/other' }); res.end(); return; }
    if (path === '/blocks/tip/height') { res.end(mode === 'genesis' ? '0' : '20'); return; }
    if (path.startsWith('/block-height/')) { res.end(mode === 'wrongHash' ? hash(99) : hash(Number(path.split('/').pop()))); return; }
    if (path.includes('/txs')) {
      histories++; let rows = Array.from({ length: 10 }, (_, n) => transaction(n + (path.includes('after_txid') ? 11 : 1)));
      if (mode === 'oversized') rows.push(transaction(30));
      if (mode === 'duplicate') rows[1] = rows[0];
      if (mode === 'order') rows[1].status.block_height = 21;
      if (mode === 'cursor') rows[0] = transaction(10);
      if (mode === 'inexact') rows[0].vout[0].value = Number.MAX_SAFE_INTEGER + 1;
      if (mode === 'changedHistory' && histories === 2) rows[0] = transaction(99);
      res.end(JSON.stringify(rows)); return;
    }
    summaries++; const value = summary();
    if (mode === 'changedSummary' && summaries === 2) value.chain_stats.tx_count++;
    if (mode === 'inexactSummary') value.chain_stats.funded_txo_sum = Number.MAX_SAFE_INTEGER + 1;
    res.end(mode === 'largeBody' ? 'x'.repeat(4 * 1024 * 1024 + 1) : JSON.stringify(value));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
afterEach(async () => { delete process.env.UNIVERSE_SIGNET_CHALLENGE; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
const reader = (budget = 15000) => new AddressHttpReader(origin, (height, readHash, signal) => verifyAddressHttpSource(height, readHash, core, signal), budget);
const balance = async () => ({ confirmed: 1210000000000, unconfirmed: 0 });

it('serves exact native high-turnover summary without loading capped TCP history', async () => {
  const readBalance = jest.fn(balance); const value = await reader().summary(address, readBalance);
  expect(value.chain_stats).toEqual(stats()); expect(value.electrum).toBe(true); expect(readBalance).toHaveBeenCalledTimes(2);
  expect(paths.filter(p => p === '/address/' + address)).toHaveLength(2);
  expect(core.rpc.call.mock.calls.every(call => call[2]?.signal instanceof AbortSignal)).toBe(true);
});
it('uses exactly10-row native cursor reads and excludes the previous cursor without scans', async () => {
  const r = reader(); const first = await r.history(address, ''); const second = await r.history(address, first[9].txid);
  expect(first).toHaveLength(10); expect(second).toHaveLength(10);
  expect(first.map(t => t.txid).some(id => second.some(t => t.txid === id))).toBe(false);
  expect(paths.filter(p => p.includes('/txs'))).toEqual([
    '/address/' + address + '/txs?max_txs=10', '/address/' + address + '/txs?max_txs=10',
    '/address/' + address + '/txs?max_txs=10&after_txid=' + hash(10), '/address/' + address + '/txs?max_txs=10&after_txid=' + hash(10),
  ]);
});
it.each(['wrongHash', 'genesis'])('rejects %s source proof before returning address data', async defect => {
  mode = defect; await expect(reader().summary(address, balance)).rejects.toThrow(); expect(summaries).toBe(0);
});
it.each(['main', 'wrongChallenge'])('rejects actual owned-node %s proof, independently of the configured label', async defect => {
  core.rpc.call.mockImplementation(async method => method === 'getblockchaininfo'
    ? { chain: defect === 'main' ? 'main' : 'signet', blocks: 20, bestblockhash: hash(20), signet_challenge: defect === 'wrongChallenge' ? '52' : '51' } : hash(20));
  await expect(reader().summary(address, balance)).rejects.toThrow(); expect(summaries).toBe(0);
});
it('rejects an independently owned but stale native checkpoint without another Core call or address payload', async () => {
  core.rpc.call.mockImplementation(async (method, params) => method === 'getblockchaininfo'
    ? { chain: 'signet', blocks: 30, bestblockhash: hash(30), signet_challenge: '51' } : hash(params[0]));
  await expect(reader().summary(address, balance)).rejects.toMatchObject({ code: 'EADDRESSSOURCE' });
  expect(core.rpc.call).toHaveBeenCalledTimes(1); expect(summaries).toBe(0);
});
it.each(['changedSummary', 'inexactSummary'])('rejects %s summary rather than emitting guessed holdings', async defect => {
  mode = defect; await expect(reader().summary(address, balance)).rejects.toMatchObject({ code: 'EADDRESSSOURCE' });
});
it('rejects HTTP/TCP balance disagreement', async () => {
  await expect(reader().summary(address, async () => ({ confirmed: 1, unconfirmed: 0 }))).rejects.toMatchObject({ code: 'EADDRESSSOURCE' });
});
it.each(['oversized', 'duplicate', 'cursor', 'inexact', 'changedHistory', 'order'])('rejects %s history without fetching further pages', async defect => {
  mode = defect; await expect(reader().history(address, hash(10))).rejects.toMatchObject({ code: 'EADDRESSSOURCE' }); expect(histories).toBeLessThanOrEqual(2);
});
it('rejects checkpoint movement after body acquisition', async () => {
  const r = new AddressHttpReader(origin, async (height, readHash, signal) => {
    const proof = await verifyAddressSource(height, readHash, core, 15000, signal);
    return { ...proof, blockHash: summaries ? hash(21) : hash(20) };
  });
  await expect(r.summary(address, balance)).rejects.toMatchObject({ code: 'EADDRESSSOURCE' });
});
it('bounds redirects and oversized payloads without another origin or fallback', async () => {
  mode = 'redirect'; await expect(reader().history(address, '')).rejects.toThrow(); expect(paths).toEqual(['/blocks/tip/height']);
  mode = 'largeBody'; await expect(reader().summary(address, balance)).rejects.toThrow();
});
it('cancels queued and active work, cleans caller listeners and permits a fresh retry', async () => {
  const r = reader(1000); const controller = new AbortController(); mode = 'timeout';
  const remove = jest.spyOn(controller.signal, 'removeEventListener'); const pending = r.summary(address, balance, controller.signal);
  await new Promise(resolve => setTimeout(resolve, 30)); controller.abort(); await expect(pending).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); mode = '';
  expect((await r.summary(address, balance)).chain_stats.tx_count).toBe(13500);
  const aborted = new AbortController(); aborted.abort(); const before = paths.length;
  await expect(r.history(address, '', aborted.signal)).rejects.toThrow(); expect(paths).toHaveLength(before);
});
it('bounds the entire operation including a silent native response', async () => {
  mode = 'timeout'; await expect(reader(50).summary(address, balance)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
});
it('cancels work queued behind the single HTTP socket without starting a second native request', async () => {
  const r = reader(1000), first = new AbortController(), queued = new AbortController(); mode = 'timeout';
  const pending = r.summary(address, balance, first.signal);
  const pendingResult = pending.catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 25));
  const waiting = r.history(address, '', queued.signal); const waitingResult = waiting.catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 25)); queued.abort();
  expect((await waitingResult).code).toBe('ETIMEDOUT'); expect(paths).toEqual(['/blocks/tip/height']);
  first.abort(); expect((await pendingResult).code).toBe('ETIMEDOUT');
  mode = ''; expect(await r.history(address, '')).toHaveLength(10);
});
it('shares one connected HTTP socket across parallel address operations', async () => {
  let connected = 0, maximum = 0;
  server.on('connection', socket => { connected++; maximum = Math.max(maximum, connected); socket.once('close', () => connected--); });
  const r = reader(); await Promise.all([r.summary(address, balance), r.history(address, '')]);
  expect(maximum).toBe(1);
});
it.each(['https://127.0.0.1:3022', 'http://example.com', 'http://user:pass@127.0.0.1:3022', 'http://127.0.0.1:3022/path', 'http://127.0.0.1:3022?fallback=1', ''])('rejects unqualified origin %s', url => {
  expect(() => new AddressHttpReader(url, jest.fn())).toThrow();
});

it.each<AddressReadPhase>(['checkpoint-before', 'address-validation', 'balance-first', 'http-summary-first',
  'http-summary-repeat', 'balance-repeat', 'checkpoint-after'])('reports actual failure phase %s without changing the error or read guards', async phase => {
  const report = jest.fn(), failure = Object.assign(Error('private origin/address/body/auth must not be copied'), { code: 'EOOPS' });
  let checkpoints = 0, balances = 0, httpSummaries = 0;
  const r = new AddressHttpReader(origin, async (height, readHash, signal) => {
    checkpoints++;
    if (phase === 'checkpoint-before' && checkpoints === 1 || phase === 'checkpoint-after' && checkpoints === 2) { throw failure; }
    return verifyAddressHttpSource(height, readHash, core, signal);
  }, 15000, { report });
  const connection = (r as unknown as { connection: { get: (url: string, options: unknown) => Promise<unknown> } }).connection;
  const get = connection.get.bind(connection);
  jest.spyOn(connection, 'get').mockImplementation((url, options) => {
    if (url.includes('/address/')) {
      httpSummaries++;
      if (phase === 'http-summary-first' && httpSummaries === 1 || phase === 'http-summary-repeat' && httpSummaries === 2) { return Promise.reject(failure); }
    }
    return get(url, options);
  });
  await expect(r.summary(address, async () => {
    balances++;
    if (phase === 'balance-first' && balances === 1 || phase === 'balance-repeat' && balances === 2) { throw failure; }
    return balance();
  }, undefined, async () => { if (phase === 'address-validation') { throw failure; } })).rejects.toBe(failure);
  expect(report).toHaveBeenCalledTimes(1);
  expect(report.mock.calls[0][0]).toMatchObject({ phase, category: 'upstream-failure', consumerDeadlineMs: 15000 });
  expect(JSON.stringify(report.mock.calls)).not.toContain('private origin/address/body/auth');
  expect(report.mock.calls[0][0].elapsedMs).toBeGreaterThanOrEqual(report.mock.calls[0][0].phaseElapsedMs);
});

it('keeps exact validation/balance/body/proof order and emits no diagnostic on success', async () => {
  const order: string[] = [], report = jest.fn();
  const r = new AddressHttpReader(origin, async (height, readHash, signal) => {
    order.push(order.length ? 'checkpoint-after' : 'checkpoint-before');
    return verifyAddressHttpSource(height, readHash, core, signal);
  }, 15000, { report });
  const connection = (r as unknown as { connection: { get: (url: string, options: unknown) => Promise<unknown> } }).connection;
  const get = connection.get.bind(connection);
  jest.spyOn(connection, 'get').mockImplementation((url, options) => { if (url.includes('/address/')) { order.push('http-summary'); } return get(url, options); });
  await r.summary(address, async () => { order.push('balance'); return balance(); }, undefined, async () => { order.push('validation'); });
  expect(order).toEqual(['checkpoint-before', 'validation', 'balance', 'http-summary', 'http-summary', 'balance', 'checkpoint-after']);
  expect(report).not.toHaveBeenCalled();
});

it.each(['changedSummary', 'wrongHash'])('diagnostic preserves %s source-disagreement rejection', async defect => {
  mode = defect; const report = jest.fn();
  const r = new AddressHttpReader(origin, (height, readHash, signal) => verifyAddressHttpSource(height, readHash, core, signal), 15000, { report });
  if (defect === 'wrongHash') { await expect(r.summary(address, balance)).rejects.toThrow('Address source differs'); }
  else { await expect(r.summary(address, balance)).rejects.toMatchObject({ code: 'EADDRESSSOURCE' }); }
  expect(report).toHaveBeenCalledTimes(1);
  expect(report.mock.calls[0][0].category).toBe(defect === 'changedSummary' ? 'source-disagreement' : 'upstream-failure');
});

it.each([5000, 15000])('caller cancellation %sms or existing operation deadline keeps raw ownership and discards late response', async budget => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'performance'] });
  try {
    const controller = new AbortController(), admission = new AddressReadAdmission(1), report = jest.fn();
    let entered: () => void = jest.fn(), finish: (value: { confirmed: number; unconfirmed: number }) => void = jest.fn();
    const started = new Promise<void>(resolve => { entered = resolve; });
    const raw = new Promise<{ confirmed: number; unconfirmed: number }>(resolve => { finish = resolve; });
    const r = new AddressHttpReader(origin, (height, readHash, signal) => verifyAddressHttpSource(height, readHash, core, signal), 15000, { report, now: (): number => Date.now() });
    const result = admission.run(() => r.summary(address, () => admission.track(() => { entered(); return raw; }), controller.signal));
    const ended = result.catch(error => error); await started;
    jest.advanceTimersByTime(budget); if (budget === 5000) { controller.abort(); }
    expect(await ended).toMatchObject({ code: 'ETIMEDOUT' });
    expect(report.mock.calls[0][0]).toMatchObject({ phase: 'balance-first', category: budget === 5000 ? 'caller-cancelled' : 'operation-deadline', elapsedMs: budget });
    await expect(admission.run(async () => 'another address')).rejects.toMatchObject({ code: 'EADDRESSBUSY' });
    const priorPaths = paths.length;
    finish({ confirmed: 1210000000000, unconfirmed: 0 });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(paths).toHaveLength(priorPaths); expect(report).toHaveBeenCalledTimes(1);
    await expect(admission.run(async () => 'fresh observation')).resolves.toBe('fresh observation');
  } finally { jest.useRealTimers(); }
});

it.each(['throws', 'rejects'])('reporter %s does not replace source failure', async behavior => {
  const failure = Object.assign(Error('original source failure'), { code: 'EOOPS' });
  const r = new AddressHttpReader(origin, async () => { throw failure; }, 15000, {
    report: (): Promise<void> => { if (behavior === 'throws') { throw Error('logger failure'); } return Promise.reject(Error('logger failure')); },
  });
  await expect(r.summary(address, balance)).rejects.toBe(failure);
  await Promise.resolve();
});
