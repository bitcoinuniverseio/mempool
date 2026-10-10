import express from 'express';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { initUtxoReconstructionV4Routes, reconstructionInspectionBinding } from '../api/bitcoin/utxo-reconstruction-v4.routes';

const create = jest.fn(), next = jest.fn(), cancel = jest.fn(), inspect = jest.fn(), sourceCreated = jest.fn();
jest.mock('../config', () => ({ __esModule: true, default: { MEMPOOL: { NETWORK: 'signet', API_URL_PREFIX: '/api/v1/' } } }));
jest.mock('../api/bitcoin/reconstruction-v4-binding', () => ({configuredReconstructionV4Binding: () => ({network:'signet',releaseSha:'a'.repeat(40),configurationSha256:'b'.repeat(64)})}));
jest.mock('../api/bitcoin/utxo-reconstruction-v4.source', () => ({ EsploraReconstructionV4Source: class { constructor() {sourceCreated();} } }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: { rpc: { call: jest.fn() } } }));
jest.mock('../api/bitcoin/utxo-reconstruction-v4.service', () => ({

  UtxoReconstructionV4Service: class {
    create(...args) { return create(...args); }
    next(...args) { return next(...args); }
    inspect(...args) { return inspect(...args); }
    cancel(...args) { return cancel(...args); }
  },
}));

let server: Server, origin: string;
const binding = {network:'signet',releaseSha:'a'.repeat(40),configurationSha256:'b'.repeat(64)};
const query = '?network=signet&releaseSha='+binding.releaseSha+'&configurationSha256='+binding.configurationSha256;
const id = '12345678-1234-1234-1234-123456789012';
beforeAll(async () => {
  const app = express(); app.use(express.json()); initUtxoReconstructionV4Routes(app);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => { create.mockReset(); next.mockReset(); cancel.mockReset(); inspect.mockReset(); sourceCreated.mockClear(); });

it('inspection before any session creates neither source nor service resource', async () => {
  const response=await fetch(origin+`/api/v1/address/tb1qfixture/utxo-reconstruction/v4/${id}`+query);
  expect(response.status).toBe(404);expect(sourceCreated).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();expect(inspect).not.toHaveBeenCalled();
});
it('mounts only the explicit create/advance/cancel contracts with no-store responses', async () => {
  create.mockResolvedValue({ sessionId: id, cursor: 0, status: 'PARTIAL' });
  let response = await fetch(origin + '/api/v1/address/tb1qfixture/utxo-reconstruction/v4', { method: 'POST' });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ cursor: 0, status: 'PARTIAL' });
  expect(create).toHaveBeenCalledWith('tb1qfixture', expect.any(AbortSignal));
  next.mockResolvedValue({ sessionId: id, cursor: 1, status: 'PARTIAL' });
  response = await fetch(origin + `/api/v1/address/tb1qfixture/utxo-reconstruction/v4/${id}/next`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cursor: 0 }),
  });
  expect(response.status).toBe(200); expect(next).toHaveBeenCalledWith('tb1qfixture', id, 0, expect.any(AbortSignal));
  cancel.mockReturnValue({ sessionId: id, cursor: 1, status: 'CANCELLED' });
  response = await fetch(origin + `/api/v1/address/tb1qfixture/utxo-reconstruction/v4/${id}`, { method: 'DELETE' });
  expect(await response.json()).toMatchObject({ status: 'CANCELLED' }); expect(cancel).toHaveBeenCalledWith('tb1qfixture', id);
  expect((await fetch(origin + '/api/v1/address/tb1qfixture/utxo-reconstruction/v4')).status).toBe(404);
});
it('rejects absent or inexact cursors before invoking an upstream operation', async () => {
  for (const body of [{}, { cursor: '0' }, { cursor: -1 }, { cursor: 0.5 }]) {
    const response = await fetch(origin + `/api/v1/address/tb1qfixture/utxo-reconstruction/v4/${id}/next`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  }
  expect(next).not.toHaveBeenCalled();
});
it('sanitizes provider failures instead of returning upstream configuration or credentials', async () => {
  create.mockRejectedValue(new Error('credential-bearing provider diagnostic'));
  const response = await fetch(origin + '/api/v1/address/tb1qfixture/utxo-reconstruction/v4', { method: 'POST' });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'Configured reconstruction source could not be verified or reached' });
});

it('mounts state-only no-store inspection with exact binding and no source admission', async () => {
  inspect.mockReturnValue({schema:'universe-address-utxo-reconstruction-inspection-v1',cursor:1,busy:false});
  const response=await fetch(origin+`/api/v1/address/tb1qfixture/utxo-reconstruction/v4/${id}`+query);
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toMatchObject({cursor:1,busy:false});
  expect(inspect).toHaveBeenCalledWith('tb1qfixture',id,binding);expect(sourceCreated).not.toHaveBeenCalled();expect(next).not.toHaveBeenCalled();
});
it('rejects absent, duplicated, foreign and unknown inspection query fields', async () => {
  for(const suffix of ['',query+'&network=mainnet',query+'&extra=1',query.replace('network=signet','network=unknown'),query.replace(binding.releaseSha,'short')]) {
    expect((await fetch(origin+`/api/v1/address/tb1qfixture/utxo-reconstruction/v4/${id}`+suffix)).status).toBe(400);
  }
  expect(inspect).not.toHaveBeenCalled();expect(sourceCreated).not.toHaveBeenCalled();
});

it('pure inspection guard rejects malformed length, body and transfer headers', () => {
  for(const length of ['bad','-1','1','0x0','',0,['0']]) expect(()=>reconstructionInspectionBinding(binding,length,undefined)).toThrow('binding required');
  expect(()=>reconstructionInspectionBinding(binding,'0','chunked')).toThrow('binding required');
  expect(reconstructionInspectionBinding(binding,undefined,undefined)).toEqual(binding);
  expect(reconstructionInspectionBinding(binding,'0',undefined)).toEqual(binding);
});
