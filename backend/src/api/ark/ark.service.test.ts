import { Application, Request, Response } from 'express';
import arkRoutes from './ark.routes';
import { ArkEvidenceError, arkService } from './ark.service';

/**
 * These assertions replace a suite that asserted the constants the service
 * used to return: an operator that was online because the constant said so,
 * a batch that was settled with an invented anchor txid, and a VTXO that was
 * spendable with a 2016-block timelock. Passing those proved the constants
 * were present, not that any round or VTXO had been observed.
 */
describe('ArkService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing Ark provider rather than invented operators, rounds and VTXOs', async () => {
    await expect(arkService.$getOperators()).rejects.toThrow(unavailable('unavailable-ark-provider'));
    await expect(arkService.$getBatches()).rejects.toThrow(unavailable('unavailable-ark-provider'));
    await expect(arkService.$getBatch('13b42434-ef46-4c68-b367-2aecb01f7b2a')).rejects.toThrow(unavailable('unavailable-ark-provider'));
    await expect(arkService.$getVtxo('vtxo-78192a83918273918273918273918273')).rejects.toThrow(unavailable('unavailable-ark-projection'));
    await expect(arkService.$getVirtualTxs()).rejects.toThrow(unavailable('unavailable-ark-projection'));
  });

  it('never resolves an absent source as an empty directory', async () => {
    for (const read of [
      () => arkService.$getOperators(),
      () => arkService.$getBatches(),
      () => arkService.$getBatch('13b42434-ef46-4c68-b367-2aecb01f7b2a'),
      () => arkService.$getVtxo('unknown'),
      () => arkService.$getVirtualTxs(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(ArkEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Ark exit proof verification boundary', () => {
  it.each([
    ['', ['ab'.repeat(32)]],
    ['vtxo-1', []],
    ['vtxo-1', ['not-a-hash']],
    [undefined, undefined],
  ])('rejects malformed proofs', async (vtxoId, proofPath) => {
    await expect(arkService.$verifyProof(vtxoId, proofPath)).resolves.toMatchObject({ valid: false, stage: 'invalid-input' });
  });

  it('never verifies a well-formed proof path without an actual Ark provider', async () => {
    // The revision this replaces answered valid, with a fixed root, for any array.
    const result = await arkService.$verifyProof('vtxo-1', ['ab'.repeat(32), 'cd'.repeat(32)]);
    expect(result.valid).toBe(false);
    expect(result.stage).toBe('unavailable-verifier');
    expect(result).not.toHaveProperty('root');
  });
});

describe('Ark HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): { gets: Map<string, Handler>; post: Handler; nativePost: Handler } {
    const gets = new Map<string, Handler>();
    let post!: Handler;
    let nativePost!: Handler;
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((path: string, callback: Handler) => { if (path.endsWith('/verify')) post = callback;
        if (path.endsWith('/verify/native')) nativePost = callback; return app; }),
    };
    arkRoutes.initRoutes(app as unknown as Application);
    return { gets, post, nativePost };
  }

  it.each([
    [{}, 400, 'invalid-input'],
    [{ vtxoId: 'vtxo-1', proofPath: [] }, 400, 'invalid-input'],
    [{ vtxoId: 'vtxo-1', proofPath: ['ab'.repeat(32)] }, 503, 'unavailable-verifier'],
  ])('never returns successful verification for missing or unverified proof data', async (body, status, stage) => {
    const { post } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await post({ body } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ valid: false, stage }));
  });

  it('answers every read with a 503 that names the missing source', async () => {
    const { gets } = mount();
    expect(gets.size).toBe(5);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { batchId: '13b42434-ef46-4c68-b367-2aecb01f7b2a', vtxoId: 'vtxo-1' } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('operators');
      expect(body).not.toHaveProperty('batches');
      expect(body).not.toHaveProperty('virtualTxs');
    }
  });
  it.each([{ limit: ['1', '2'] }, { before: { value: '100' } }, { after: '-1' }, { limit: '101' }, { withFailed: 'true' }])(
    'rejects malformed or privileged catalogue selectors before native IO %j', async query => {
      const { gets } = mount();
      const handler = [...gets.entries()].find(([path]) => path.endsWith('/batches'))![1];
      const read = jest.spyOn(arkService, '$getBatchPage');
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      try {
        await handler({ query } as unknown as Request, res as unknown as Response);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(read).not.toHaveBeenCalled();
      } finally { read.mockRestore(); }
    });
  it('reports a bounded catalogue observation without a fabricated global total or continuation', async () => {
    const { gets } = mount();
    const handler = [...gets.entries()].find(([path]) => path.endsWith('/batches'))![1];
    const read = jest.spyOn(arkService, '$getBatchPage').mockResolvedValue({ batches: [], nativeObservedCount: 1 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    try {
      await handler({ query: { after: '0', before: '100', limit: '10' } } as unknown as Request, res as unknown as Response);
      expect(res.json).toHaveBeenCalledWith({ batches: [], total: null, page: { after: '0', before: '100', limit: 10,
        nativeObservedCount: 1, observedCount: 0, completeCatalogue: false, scope: 'bounded-native-completed-rounds', continuation: null } });
    } finally { read.mockRestore(); }
  });
  it('rejects a hash-array proof on the mounted versioned route before native reads', async () => {
    const { nativePost } = mount(); const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await nativePost({ body: { vtxoId: 'vtxo-1', proofPath: ['ab'.repeat(32)] } } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ valid: false, stage: 'invalid-native-proof', exitViable: null, protocolVerified: null }));
  });
  it('preserves unavailable native verifier semantics on the mounted versioned route', async () => {
    const { nativePost } = mount(); const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await nativePost({ body: { schema: 'universe-ark-native-proof-v1' } } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ valid: null, stage: 'unavailable-native-verifier', exitViable: null, protocolVerified: null }));
  });
});
