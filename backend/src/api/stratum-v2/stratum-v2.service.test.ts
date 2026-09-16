import { Application, Request, Response } from 'express';
import stratumV2Routes from './stratum-v2.routes';
import { StratumV2EvidenceError, stratumV2Service } from './stratum-v2.service';

/**
 * These assertions replace a suite that asserted the constants the service
 * used to return: a role whose Noise handshake was secured because the
 * constant said so, a template with a positive declared count, and a job
 * declaration accepted by a pool that never received it. Passing those
 * proved the constants were present, not that any SV2 role had reported.
 */
describe('StratumV2Service', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing SV2 roles rather than invented endpoints, templates and declarations', async () => {
    await expect(stratumV2Service.$getRoles()).rejects.toThrow(unavailable('unavailable-sv2-roles'));
    await expect(stratumV2Service.$getTemplates()).rejects.toThrow(unavailable('unavailable-sv2-roles'));
    await expect(stratumV2Service.$getDeclarations()).rejects.toThrow(unavailable('unavailable-sv2-roles'));
  });

  it('never resolves an absent source as an empty directory', async () => {
    for (const read of [
      () => stratumV2Service.$getRoles(),
      () => stratumV2Service.$getTemplates(),
      () => stratumV2Service.$getDeclarations(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(StratumV2EvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Stratum V2 HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): Map<string, Handler> {
    const gets = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
    };
    stratumV2Routes.initRoutes(app as unknown as Application);
    return gets;
  }

  it('answers every read with a 503 that names the missing source', async () => {
    const gets = mount();
    expect(gets.size).toBe(3);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: {} } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('roles');
      expect(body).not.toHaveProperty('templates');
      expect(body).not.toHaveProperty('declarations');
    }
  });
});
