import { ReconstructionAcquisitionError } from '../api/bitcoin/utxo-reconstruction.source';
import express from 'express';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { initUtxoReconstructionV2Routes } from '../api/bitcoin/utxo-reconstruction-v2.routes';

const create = jest.fn(), next = jest.fn(), cancel = jest.fn();
jest.mock('../config', () => ({ __esModule: true, default: { MEMPOOL: { NETWORK: 'signet', API_URL_PREFIX: '/api/v1/' } } }));
jest.mock('../api/bitcoin/utxo-reconstruction.source', () => {
  const { ReconstructionError } = jest.requireMock('../api/bitcoin/utxo-reconstruction.service');
  return { EsploraReconstructionSource: class {}, ReconstructionAcquisitionError: class extends ReconstructionError {
    constructor(public phase: string, public upstreamStatus: number, public causeCode: string) { super(causeCode === 'DEADLINE' ? 504 : 503, 'Bounded reconstruction source acquisition failed'); }
  } };
});
jest.mock('../api/bitcoin/utxo-reconstruction-v2.service', () => ({ UtxoReconstructionV2Service: class {
  create(...args) { return create(...args); }
  next(...args) { return next(...args); }
  cancel(...args) { return cancel(...args); }
} }));
jest.mock('../api/bitcoin/utxo-reconstruction.service', () => ({
  ReconstructionError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  UtxoReconstructionService: class {
    create(...args) { return create(...args); }
    next(...args) { return next(...args); }
    cancel(...args) { return cancel(...args); }
  },
}));

let server: Server, origin: string;
const id = '12345678-1234-1234-1234-123456789012';
beforeAll(async () => {
  const app = express(); app.use(express.json()); initUtxoReconstructionV2Routes(app);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => { create.mockReset(); next.mockReset(); cancel.mockReset(); });

it('mounts only the explicit create/advance/cancel contracts with no-store responses', async () => {
  create.mockResolvedValue({ sessionId: id, cursor: 0, status: 'PARTIAL' });
  let response = await fetch(origin + '/api/v1/address/tb1qfixture/utxo-reconstruction/v2', { method: 'POST' });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ cursor: 0, status: 'PARTIAL' });
  expect(create).toHaveBeenCalledWith('tb1qfixture', expect.any(AbortSignal));
  next.mockResolvedValue({ sessionId: id, cursor: 1, status: 'PARTIAL' });
  response = await fetch(origin + `/api/v1/address/tb1qfixture/utxo-reconstruction/v2/${id}/next`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cursor: 0 }),
  });
  expect(response.status).toBe(200); expect(next).toHaveBeenCalledWith('tb1qfixture', id, 0, expect.any(AbortSignal));
  cancel.mockReturnValue({ sessionId: id, cursor: 1, status: 'CANCELLED' });
  response = await fetch(origin + `/api/v1/address/tb1qfixture/utxo-reconstruction/v2/${id}`, { method: 'DELETE' });
  expect(await response.json()).toMatchObject({ status: 'CANCELLED' }); expect(cancel).toHaveBeenCalledWith('tb1qfixture', id);
  expect((await fetch(origin + '/api/v1/address/tb1qfixture/utxo-reconstruction/v2')).status).toBe(404);
});
it('rejects absent or inexact cursors before invoking an upstream operation', async () => {
  for (const body of [{}, { cursor: '0' }, { cursor: -1 }, { cursor: 0.5 }]) {
    const response = await fetch(origin + `/api/v1/address/tb1qfixture/utxo-reconstruction/v2/${id}/next`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  }
  expect(next).not.toHaveBeenCalled();
});
it('sanitizes provider failures instead of returning upstream configuration or credentials', async () => {
  create.mockRejectedValue(new Error('credential-bearing provider diagnostic'));
  const response = await fetch(origin + '/api/v1/address/tb1qfixture/utxo-reconstruction/v2', { method: 'POST' });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'Configured reconstruction source could not be verified or reached' });
});

it('retains typed upstream phase/status and bounded deadline diagnostics without raw error messages', async () => {
  for (const [code, status] of [['UPSTREAM_UNAVAILABLE', 503], ['DEADLINE', 504]] as const) {
    create.mockRejectedValueOnce(new ReconstructionAcquisitionError('confirmed-history', 429, code));
    const response = await fetch(origin + '/api/v1/address/tb1qfixture/utxo-reconstruction/v2', { method: 'POST' });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Bounded reconstruction source acquisition failed', phase: 'confirmed-history', sourceFailure: { code, upstreamStatus: 429 } });
  }
});