import { Application, Request, Response } from 'express';
import workbenchRoutes from './workbench.routes';
import { WorkbenchEvidenceError, workbenchService } from './workbench.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: every script consensus-valid, a stack simulation that always ran
 * one successful OP_CHECKSIG, one Miniscript for every policy, random derived
 * addresses, and a PSBT whose txid and fee never changed. Passing those proved
 * the constants were present, not that anything was analysed.
 */
describe('Product 7: Bitcoin Script, Descriptor, Miniscript, and PSBT Workbench', () => {
  const p2wpkhScript = '0014751e76e8199196d454941c45d1b3a323f1433bd6';
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing script engine rather than an analysis that calls any script valid', () => {
    expect(() => workbenchService.analyzeScript(p2wpkhScript)).toThrow(unavailable('unavailable-script-engine'));
    expect(() => workbenchService.simulateStack(p2wpkhScript, ['30440220...', '0279be66...'])).toThrow(unavailable('unavailable-script-engine'));
    expect(() => workbenchService.compileMiniscript('and(pk(A),older(144))')).toThrow(unavailable('unavailable-script-engine'));
  });

  it('reports the missing descriptor wallet rather than random derived addresses', () => {
    expect(() => workbenchService.parseDescriptor('wpkh([d34db33f/84h/0h/0h]xpub6ERApfZtsWPgv2EZpqRz12345/0/*)#abc12345'))
      .toThrow(unavailable('unavailable-descriptor-wallet'));
  });

  it('reports the missing PSBT decoder rather than a constant txid and fee', () => {
    expect(() => workbenchService.analyzePsbt('70736274ff0100520200000001000000')).toThrow(unavailable('unavailable-psbt-decoder'));
  });

  it('never resolves an absent engine as an empty analysis', () => {
    for (const read of [
      () => workbenchService.analyzeScript(p2wpkhScript),
      () => workbenchService.simulateStack(p2wpkhScript),
      () => workbenchService.compileMiniscript('pk(A)'),
      () => workbenchService.parseDescriptor('wpkh(A)'),
      () => workbenchService.analyzePsbt('70736274ff'),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(WorkbenchEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Workbench HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): Map<string, Handler> {
    const posts = new Map<string, Handler>();
    const app = {
      post: jest.fn((path: string, callback: Handler) => { posts.set(path, callback); return app; }),
    };
    workbenchRoutes.initRoutes(app as unknown as Application);
    return posts;
  }

  it('answers every analysis with a 503 that names the missing engine', async () => {
    const posts = mount();
    expect(posts.size).toBe(6);
    const body = { script_hex: '0014ab', witness: [], policy: 'pk(A)', descriptor: 'wpkh(A)', psbt: '70736274ff' };
    for (const handler of posts.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ body } as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const answer = res.json.mock.calls[0][0];
      expect(answer.stage).toMatch(/^unavailable-/);
      expect(typeof answer.error).toBe('string');
      expect(answer).not.toHaveProperty('steps');
      expect(answer).not.toHaveProperty('derived');
      expect(answer).not.toHaveProperty('is_complete');
    }
  });

  it('keeps a 400 for a request with nothing to analyse', async () => {
    const posts = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await posts.get('/api/v1/intelligence/workbench/psbt/analyze')!({ body: {} } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
