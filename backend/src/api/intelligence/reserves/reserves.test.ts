import { Application, Request, Response } from 'express';
import crypto from 'crypto';
import reservesRoutes from './reserves.routes';
import { ReservesEvidenceError, reservesService } from './reserves.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: three providers with invented names, snapshots that were verified
 * on chain because the constant said so, and a solvency ratio that was above
 * 100 percent by construction. Passing those proved the constants were present,
 * not that any attestation had been observed.
 */
describe('ReservesService', () => {
  const unavailable = expect.objectContaining({ code: 'unavailable-attestation-ingest', status: 503 });

  it('reports the missing attestation ingest rather than a directory of invented providers', () => {
    expect(() => reservesService.getOverview()).toThrow(unavailable);
    expect(() => reservesService.getProviders()).toThrow(unavailable);
    expect(() => reservesService.getProviderById('prov-bitreserve-custody')).toThrow(unavailable);
    expect(() => reservesService.getSnapshots()).toThrow(unavailable);
    expect(() => reservesService.getSnapshots('prov-apex-exchange')).toThrow(unavailable);
    expect(() => reservesService.getSnapshotById('snap-860395-bitreserve')).toThrow(unavailable);
  });

  it('never resolves an absent source as an empty directory', () => {
    for (const read of [
      () => reservesService.getOverview(),
      () => reservesService.getProviders(),
      () => reservesService.getSnapshots(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(ReservesEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });

  it('still verifies a Merkle inclusion proof supplied by the caller', () => {
    const leaf = crypto.createHash('sha256').update('leaf-data').digest('hex');
    const sibling = crypto.createHash('sha256').update('sibling-data').digest('hex');

    const h = crypto.createHash('sha256');
    if (leaf < sibling) {
      h.update(leaf + sibling);
    } else {
      h.update(sibling + leaf);
    }
    const root = h.digest('hex');

    const res = reservesService.verifyProof({
      proof_type: 'merkle_inclusion',
      merkle_proof: {
        merkle_root: root,
        leaf_hash: leaf,
        path: [sibling],
        index: 0,
        expected_liability_sats: 1000000,
      },
    });

    expect(res.verified).toBe(true);
    expect(res.total_verified_sats).toBe(1000000);
  });

  it('rejects invalid proof packages', () => {
    const res = reservesService.verifyProof({
      proof_type: 'bip127',
      bip127_proof: {
        expected_message: 'test',
        items: [],
      },
    });
    expect(res.verified).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});

describe('Reserves HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): Map<string, Handler> {
    const gets = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn(() => app),
    };
    reservesRoutes.initRoutes(app as unknown as Application);
    return gets;
  }

  it('answers every observation read with a 503 that names the missing source', async () => {
    const gets = mount();
    expect(gets.size).toBe(5);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { providerId: 'p', snapshotId: 's' }, query: {} } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toBe('unavailable-attestation-ingest');
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('providers');
      expect(body).not.toHaveProperty('recent_snapshots');
    }
  });
});
