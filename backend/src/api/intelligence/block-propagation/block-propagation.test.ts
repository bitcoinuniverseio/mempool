import { Application, Request, Response } from 'express';
import blockPropagationRoutes from './block-propagation.routes';
import blockPropagationService, { BlockPropagationEvidenceError } from './block-propagation.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: three sensors in three regions, a block whose stage timings were
 * positive by construction, a reconstruction success rate of exactly 100, a
 * fork race negotiated over BIP434 because the constant said so, and a FIBRE
 * delivery that saved time because the constant said so. Passing those proved
 * the constants were present, not that any block had been observed.
 */
describe('BlockPropagationService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing sensor fleet rather than invented sensors, blocks and races', () => {
    expect(() => blockPropagationService.getOverview()).toThrow(unavailable('unavailable-sensor-fleet'));
    expect(() => blockPropagationService.getLive()).toThrow(unavailable('unavailable-sensor-fleet'));
    expect(() => blockPropagationService.getBlock('00000000000000000001f3e2b1a09876543210fedcba9876543210fedcba9876'))
      .toThrow(unavailable('unavailable-sensor-fleet'));
    expect(() => blockPropagationService.listCompactBlocks()).toThrow(unavailable('unavailable-sensor-fleet'));
    expect(() => blockPropagationService.listForkRaces()).toThrow(unavailable('unavailable-sensor-fleet'));
    expect(() => blockPropagationService.getForkRace('race-864195-fork')).toThrow(unavailable('unavailable-sensor-fleet'));
    expect(() => blockPropagationService.listStaleTips()).toThrow(unavailable('unavailable-sensor-fleet'));
    expect(() => blockPropagationService.listSensors()).toThrow(unavailable('unavailable-sensor-fleet'));
  });

  it('reports the missing FIBRE relay rather than a delivery that claims to have saved time', () => {
    expect(() => blockPropagationService.listFibre()).toThrow(unavailable('unavailable-fibre-relay'));
  });

  it('never resolves an absent source as an empty directory', () => {
    for (const read of [
      () => blockPropagationService.listSensors(),
      () => blockPropagationService.listCompactBlocks(),
      () => blockPropagationService.listForkRaces(),
      () => blockPropagationService.listStaleTips(),
      () => blockPropagationService.listFibre(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(BlockPropagationEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Block propagation HTTP responses', () => {
  type Handler = (req: Request, res: Response) => void;

  function mount(): Map<string, Handler> {
    const gets = new Map<string, Handler>();
    const app = { get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }) };
    blockPropagationRoutes.initRoutes(app as unknown as Application);
    return gets;
  }

  it('answers every observation read with a 503 that names the missing source', () => {
    const gets = mount();
    expect(gets.size).toBe(10);
    for (const [path, handler] of gets) {
      // The event stream only announces the connection; it carries no observation.
      if (path.endsWith('/stream')) {
        continue;
      }
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      handler({ params: { blockHash: 'b', raceId: 'r' } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('sensors');
      expect(body).not.toHaveProperty('status');
    }
  });
});
