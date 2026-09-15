import http from 'http';
import express from 'express';
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: { getMempoolInfo: jest.fn(), decodeRawTransaction: jest.fn() } }));
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: { $testMempoolAccept: jest.fn() } }));
jest.mock('../api/mempool', () => ({ __esModule: true, default: { getMempool: () => ({}), getSpendMap: () => new Map(), getAccelerations: () => ({}) } }));
jest.mock('../api/mempool-intelligence/mempool-intelligence', () => ({ __esModule: true, default: { getDiagram: () => ({ points: [] }) } }));
jest.mock('../repositories/AccelerationRepository', () => ({ __esModule: true, default: { $getAccelerationInfo: jest.fn(async () => []), $getAccelerationInfoForTxid: jest.fn(async () => ({ kind: 'tx' })) } }));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
import client from '../api/bitcoin/bitcoin-client';
import api from '../api/bitcoin/bitcoin-api-factory';
import { $bumpPolicy } from '../api/mempool-intelligence/bump-service';
import { $simulate, $incrementalRelayFeeSatPerVb } from '../api/mempool-intelligence/package-service';
import routes from '../api/mempool-intelligence/mempool-intelligence.routes';
import acceleration from '../api/acceleration/acceleration.routes';
import repository from '../repositories/AccelerationRepository';
import axios from 'axios';
import { Readable } from 'stream';
import config from '../config';

const id = 'ab'.repeat(32);
const rpc = client as any;
const verdictApi = api as any;
let server: http.Server;
let origin: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); routes.initRoutes(app); acceleration.initRoutes(app);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  origin = 'http://127.0.0.1:' + (server.address() as any).port + config.MEMPOOL.API_URL_PREFIX;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  jest.clearAllMocks();
  rpc.getMempoolInfo.mockResolvedValue({ incrementalrelayfee: 0.00001, fullrbf: true });
  rpc.decodeRawTransaction.mockResolvedValue({ txid: id, vsize: 100, weight: 400, vin: [{ txid: 'cd'.repeat(32), vout: 0 }], vout: [{ value: 0.00001 }] });
  verdictApi.$testMempoolAccept.mockResolvedValue([{ txid: id, allowed: false, 'reject-reason': 'missing-inputs' }]);
});
test('named acceleration history and stats reach their actual Express handlers', async () => {
  (axios.get as jest.Mock).mockResolvedValue({ headers: { 'content-type': 'application/json' }, data: Readable.from(['{"kind":"stats"}']) });
  const history = await fetch(origin + 'services/accelerator/accelerations/history');
  expect(history.status).toBe(200); expect(await history.json()).toEqual([]);
  const stats = await fetch(origin + 'services/accelerator/accelerations/stats');
  expect(stats.status).toBe(200); expect(await stats.json()).toEqual({ kind: 'stats' });
  expect(repository.$getAccelerationInfo).toHaveBeenCalledTimes(1);
  expect(repository.$getAccelerationInfoForTxid).not.toHaveBeenCalled();
  const tx = await fetch(origin + 'services/accelerator/accelerations/' + id);
  expect(await tx.json()).toEqual({ kind: 'tx' });
});
test('policy RPC failure never supplies fallback policy', async () => {
  rpc.getMempoolInfo.mockRejectedValue(Error('connection refused'));
  await expect($bumpPolicy()).rejects.toThrow('unavailable');
  await expect($incrementalRelayFeeSatPerVb()).rejects.toThrow('unavailable');
});
test.each([{}, { incrementalrelayfee: '0.1' }, { incrementalrelayfee: Infinity }, { incrementalrelayfee: -1 }])('invalid policy %j is unavailable', async info => {
  rpc.getMempoolInfo.mockResolvedValue(info);
  await expect($incrementalRelayFeeSatPerVb()).rejects.toThrow();
});
test('zero is an explicit fee, while missing replacement policy is unknown', async () => {
  rpc.getMempoolInfo.mockResolvedValue({ incrementalrelayfee: 0, fullrbf: false });
  await expect($bumpPolicy()).resolves.toEqual({ incrementalRelayFeeSatPerVb: 0, fullReplacementEnabled: false });
  rpc.getMempoolInfo.mockResolvedValue({ incrementalrelayfee: 0 });
  await expect($bumpPolicy()).rejects.toThrow('replacement policy');
});
test('HTTP source outage is 503 with no counterfeit rejected result', async () => {
  verdictApi.$testMempoolAccept.mockRejectedValue(Error('RPC unavailable'));
  const response = await fetch(origin + 'mempool/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rawTxs: ['00'] }) });
  expect(response.status).toBe(503); expect(await response.text()).toContain('acceptance is unknown');
});
test.each([{result: []}, {result: [{ txid: id }]}, {result: [{ txid: 'cd'.repeat(32), allowed: true }]}])('unbound/incomplete verdict %j is unavailable', async ({result}) => {
  verdictApi.$testMempoolAccept.mockResolvedValue(result);
  await expect($simulate(['00'])).rejects.toThrow('acceptance is unknown');
});
test('actual explicit rejection and acceptance retain their meaning', async () => {
  const rejected = await $simulate(['00']);
  expect(rejected.accepted).toBe(false); expect(rejected.transactions[0].rejectReason).toBe('missing-inputs');
  verdictApi.$testMempoolAccept.mockResolvedValue([{ txid: id, allowed: true, vsize: 100, fees: { base: 0.00001 } }]);
  const accepted = await $simulate(['00']); expect(accepted.accepted).toBe(true); expect(accepted.packageFeeSats).toBe(1000);
});
test.each([{ value: undefined }, { value: -1 }, { value: '0.1' }, { value: Infinity }])('malformed decoder amount %j cannot become zero', async output => {
  rpc.decodeRawTransaction.mockResolvedValue({ txid: id, vsize: 100, weight: 400, vin: [{ txid: id, vout: 0 }], vout: [output] });
  await expect($simulate(['00'])).rejects.toThrow('decoder');
  expect(verdictApi.$testMempoolAccept).not.toHaveBeenCalled();
});
test('decoder transport failure remains source unavailable over HTTP',async()=>{
 rpc.decodeRawTransaction.mockRejectedValue(Error('decoder RPC offline'));
 const response=await fetch(origin+'mempool/simulate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rawTxs:['00']})});expect(response.status).toBe(503);
});
test('fractional satoshi decoder amount is not rounded into an authenticated amount',async()=>{
 rpc.decodeRawTransaction.mockResolvedValue({txid:id,vsize:100,weight:400,vin:[{txid:id,vout:0}],vout:[{value:0.000000015}]});await expect($simulate(['00'])).rejects.toThrow('decoder');
});
test('Core explicit decoding rejection retains400',async()=>{
 rpc.decodeRawTransaction.mockRejectedValue(Object.assign(Error('TX decode failed'),{code:-22}));const response=await fetch(origin+'mempool/simulate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rawTxs:['00']})});expect(response.status).toBe(400);
});
test('effective fee rate preserves fractional satoshis per kvB',async()=>{
 verdictApi.$testMempoolAccept.mockResolvedValue([{txid:id,allowed:false,fees:{'effective-feerate':0.000000015}}]);const result=await $simulate(['00']);expect(result.transactions[0].effectiveFeerate).toBeCloseTo(0.0015,10);
});
