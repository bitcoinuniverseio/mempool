jest.mock('../intelligence/utxo/utxo-intelligence.service', () => { const { UtxoEvidenceError } = require('../intelligence/utxo/utxo-evidence'); return { utxoIntelligenceService: { getOverview: async () => { throw new UtxoEvidenceError('utxo-coinstatsindex-unavailable', 'Missing owned index'); }, getCohorts: async () => { throw new UtxoEvidenceError('utxo-projection-unavailable', 'Missing owned projection'); } } }; });
import { Application, Request, Response } from 'express';
import utxoSetRoutes from './utxo-set.routes';
import { UtxoSetEvidenceError, UtxoSetService, utxoSetService } from './utxo-set.service';

/**
 * These assertions replace a suite that asserted the constants the service
 * used to return: a checkpoint with more than a hundred million outputs, a
 * P2TR cohort with a positive count, protocol-bearing counts that were
 * positive because the constant said so, and three forest roots. Passing
 * those proved the constants were present, not that any UTXO set had been
 * scanned.
 */
describe('UtxoSetService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing coinstatsindex node rather than invented checkpoints and cohorts', async () => {
    await expect(utxoSetService.$getCheckpoints()).rejects.toThrow(unavailable('utxo-coinstatsindex-unavailable'));
    await expect(utxoSetService.$getDistribution()).rejects.toThrow(unavailable('utxo-projection-unavailable'));
    await expect(utxoSetService.$getProtocolUtxos()).rejects.toThrow(unavailable('unavailable-protocol-utxo-index'));
  });

  it('reports the missing Utreexo bridge rather than invented forest roots', async () => {
    await expect(utxoSetService.$getUtreexoRoots()).rejects.toThrow(unavailable('unavailable-utreexo-bridge'));
  });

  it('never resolves an absent source as an empty directory', async () => {
    for (const read of [
      () => utxoSetService.$getCheckpoints(),
      () => utxoSetService.$getDistribution(),
      () => utxoSetService.$getProtocolUtxos(),
      () => utxoSetService.$getUtreexoRoots(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(UtxoSetEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Utreexo proof verification boundary', () => {
  it.each([undefined, [], 'ab'.repeat(32), ['not-a-hash'], [42]])('rejects malformed proofs', async (proof) => {
    await expect(utxoSetService.$verifyUtreexoProof(proof)).resolves.toMatchObject({ valid: false, stage: 'invalid-input' });
  });

  it('never verifies a well-formed proof without an actual accumulator', async () => {
    // The revision this replaces answered valid for any array, empty included.
    const result = await utxoSetService.$verifyUtreexoProof(['ab'.repeat(32), 'cd'.repeat(32)]);
    expect(result.valid).toBe(false);
    expect(result.stage).toBe('unavailable-verifier');
    expect(result).not.toHaveProperty('leafCount');
  });
});

describe('UTXO-set HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): { gets: Map<string, Handler>; post: Handler } {
    const gets = new Map<string, Handler>();
    let post!: Handler;
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((_path: string, callback: Handler) => { post = callback; return app; }),
    };
    utxoSetRoutes.initRoutes(app as unknown as Application);
    return { gets, post };
  }

  it.each([
    [{}, 400, 'invalid-input'],
    [{ proof: [] }, 400, 'invalid-input'],
    [{ proof: ['ab'.repeat(32)] }, 503, 'unavailable-verifier'],
  ])('never returns successful verification for missing or unverified proof data', async (body, status, stage) => {
    const { post } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await post({ body } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ valid: false, stage }));
  });

  it('answers every read with a 503 that names the missing source', async () => {
    const { gets } = mount();
    expect(gets.size).toBe(4);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: {} } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^(unavailable-|utxo-)/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('checkpoints');
      expect(body).not.toHaveProperty('valueCohorts');
      expect(body).not.toHaveProperty('roots');
    }
  });
});

describe('UTXO legacy contract adapters',()=>{
 it('maps actual checkpoint and reconciled cohort fields without invented commitments',async()=>{const service=new UtxoSetService({getOverview:async()=>({block_height:12,block_hash:'ab'.repeat(32),muhash:'cd'.repeat(32),total_utxos:2,total_amount_sats:123,bogo_size:'456',observed_at_utc:'2026-09-15T12:00:00Z'}),getCohorts:async()=>({value_cohorts:[{value_band:'<10k sats',utxo_count:2,total_sats:123,percent_of_supply:100}],script_types:[{script_type:'p2wpkh',utxo_count:2,total_sats:123,percent_of_supply:100}]})} as any);expect((await service.$getCheckpoints())[0]).toMatchObject({blockHeight:12,muhashHex:'cd'.repeat(32),totalAmountSats:'123'});expect(await service.$getDistribution()).toEqual({valueCohorts:[{label:'<10k sats',txOutCount:2,totalAmountSats:'123',supplyPercentage:'100'}],scriptTypes:[{scriptType:'p2wpkh',count:2,totalAmountSats:'123',percentage:'100'}]});});
});
