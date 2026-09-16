import { Application, Request, Response } from 'express';
import collaborativePrivacyRoutes from './collaborative-privacy.routes';
import collaborativePrivacyService, { CollaborativeEvidenceError } from './collaborative-privacy.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: a coordinator that was online because the literal said so, a
 * round classified protocol_proven that nothing had observed, and a bond
 * whose signature_verified was a literal true. Passing those proved the
 * constants were present, not that any coordinator, round or bond existed.
 */
describe('CollaborativePrivacyService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('still lists the static protocol reference catalogue', () => {
    const res = collaborativePrivacyService.listProtocols();
    const ids = res.protocols.map((p) => p.protocol_id);
    expect(ids).toEqual(['wabisabi', 'joinmarket', 'whirlpool_archival']);
    for (const protocol of res.protocols) {
      expect(protocol).not.toHaveProperty('health_status');
      expect(protocol).not.toHaveProperty('coordinator_signature');
    }
  });

  it('reports the missing coordinator directory rather than coordinators that are online by declaration', () => {
    expect(() => collaborativePrivacyService.listCoordinators()).toThrow(unavailable('unavailable-directory'));
    expect(() => collaborativePrivacyService.getCoordinator('coord-zk-wasabi')).toThrow(unavailable('unavailable-directory'));
  });

  it('reports the missing round source rather than rounds proven by declaration', () => {
    expect(() => collaborativePrivacyService.listRounds()).toThrow(unavailable('unavailable-round-source'));
    expect(() => collaborativePrivacyService.getRound('rnd-ws-864205-01')).toThrow(unavailable('unavailable-round-source'));
  });

  it('reports the missing bond reader rather than a bond whose signature verified itself', () => {
    expect(() => collaborativePrivacyService.listFidelityBonds()).toThrow(unavailable('unavailable-bond-source'));
  });

  it('reports the overview unavailable rather than aggregating constants', () => {
    expect(() => collaborativePrivacyService.getOverview()).toThrow(unavailable('unavailable-observation-source'));
  });

  it('never verifies a public package without the verifier', () => {
    const verification = collaborativePrivacyService.verifyPublicPackage({
      protocol: 'wabisabi',
      round_id: 'rnd-ws-864205-01',
    });
    expect(verification).toMatchObject({ verified: false, stage: 'unavailable-verifier' });
    expect(verification).not.toHaveProperty('effective_anonymity_set');
    expect(collaborativePrivacyService.verifyPublicPackage(null)).toMatchObject({ verified: false, stage: 'invalid-input' });
  });
});

describe('Collaborative privacy HTTP responses', () => {
  type Handler = (req: Request, res: Response) => unknown;

  function mount(): { gets: Map<string, Handler>; post: Handler } {
    const gets = new Map<string, Handler>();
    let post!: Handler;
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((_path: string, callback: Handler) => { post = callback; return app; }),
    };
    collaborativePrivacyRoutes.initRoutes(app as unknown as Application);
    return { gets, post };
  }

  it('answers the protocol catalogue and answers every observation read with a 503 naming the source', async () => {
    const { gets } = mount();
    expect(gets.size).toBe(7);
    for (const [path, handler] of gets) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { coordinatorId: 'x', roundId: 'y' } } as unknown as Request, res as unknown as Response);
      if (path.endsWith('/protocols')) {
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ protocols: expect.any(Array) }));
        continue;
      }
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      for (const key of ['coordinators', 'rounds', 'fidelity_bonds', 'recent_rounds', 'health_status', 'classification']) {
        expect(body).not.toHaveProperty(key);
      }
    }
  });

  it('never returns a verified public package', async () => {
    const { post } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await post({ body: { protocol: 'joinmarket' } } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ verified: false, stage: 'unavailable-verifier' }));
    expect(CollaborativeEvidenceError.name).toBe('CollaborativeEvidenceError');
  });
});
