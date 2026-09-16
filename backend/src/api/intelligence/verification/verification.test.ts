import { Application, Request, Response } from 'express';
import verificationRoutes from './verification.routes';
import { verificationService } from './verification.service';
jest.mock('../workbench/workbench-core', () => ({ ownedWorkbenchCore: { network: 'regtest', call: async () => { throw Error('Offline'); } } }));
const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });
it('returns a real invalid signature verdict and retains explicit unavailable incident capabilities', async () => {
  await expect(verificationService.verifySignature('addr', 'msg', 'A'.repeat(88))).resolves.toMatchObject({ is_valid: false });
  expect(() => verificationService.getIncidents()).toThrow(unavailable('unavailable-incident-ledger'));
  expect(() => verificationService.getIncidentById('unknown')).toThrow(unavailable('unavailable-incident-ledger'));
  await expect(verificationService.queryCompactFilter('00'.repeat(32), [])).rejects.toMatchObject({ code: 'invalid-filter-query', status: 400 });
});
function routes() {
  const handlers = new Map<string, any>(); const app = { get: (path: string, fn: any) => { handlers.set(path, fn); return app; }, post: (path: string, fn: any) => { handlers.set(path, fn); return app; } };
  verificationRoutes.initRoutes(app as unknown as Application); return handlers;
}
it('awaits asynchronous proof generation and verification before serializing a response', async () => {
  const generate = jest.spyOn(verificationService, 'generateSpvProof').mockResolvedValueOnce({ is_valid: true } as never);
  const verify = jest.spyOn(verificationService, 'verifySpvProof').mockResolvedValueOnce({ is_valid: false, error: 'Mismatch' } as never);
  const handlers = routes();
  for (const [operation, expected] of [['spv-proof', true], ['verify-spv', false]] as const) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handlers.get('/api/v1/intelligence/verification/' + operation)({ body: { txid: '11'.repeat(32), block_hash: '22'.repeat(32) } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ is_valid: expected }));
    expect(res.json.mock.calls[0][0]).not.toBeInstanceOf(Promise);
  }
  generate.mockRestore(); verify.mockRestore();
});
it('returns503 without a verdict on a valid request when the owned source is offline', async () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await routes().get('/api/v1/intelligence/verification/spv-proof')({ body: { txid: '11'.repeat(32), block_hash: '22'.repeat(32) } } as Request, res as unknown as Response);
  expect(res.status).toHaveBeenCalledWith(503); expect(res.json.mock.calls[0][0]).not.toHaveProperty('is_valid');
});
it('accepts an empty message and returns the verifier verdict', async () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await routes().get('/api/v1/intelligence/verification/verify-signature')({ body: { address: 'address', message: '', signature: 'A'.repeat(88) } }, res);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ is_valid: false }));
});
