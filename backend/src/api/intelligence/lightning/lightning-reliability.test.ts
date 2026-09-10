import { Application, Request, Response } from 'express';
import lightningReliabilityRoutes from './lightning-reliability.routes';
import { LightningReliabilityEvidenceError, lightningReliabilityService } from './lightning-reliability.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: an ACINQ node with 99.95% uptime nobody measured, a channel with
 * an invented funding txid, a closure that was settled because the constant
 * said so, and a simulation whose probability came from a seeded score.
 * Passing those proved the constants were present, not that anything had
 * been probed.
 */
describe('LightningReliabilityService', () => {
  const samplePubkey = '03864ef025fde8fb587d989186ce6a4a186895ee44a926bfc370e2c366597a3f8f';
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing probe fleet rather than a fleet overview', () => {
    expect(() => lightningReliabilityService.getOverview()).toThrow(unavailable('unavailable-probe-fleet'));
    expect(() => lightningReliabilityService.getNodeReliability(samplePubkey)).toThrow(unavailable('unavailable-probe-fleet'));
  });

  it('reports the missing channel source rather than an invented channel or closure', () => {
    expect(() => lightningReliabilityService.getChannelLifecycle('860400x120x0')).toThrow(unavailable('unavailable-channel-source'));
    expect(() => lightningReliabilityService.getClosureForensics('9f'.repeat(32))).toThrow(unavailable('unavailable-channel-source'));
  });

  it('reports the missing LSP directory rather than a directory of named providers', () => {
    expect(() => lightningReliabilityService.getLspProviders()).toThrow(unavailable('unavailable-lsp-directory'));
  });

  it('reports the missing pathfinder rather than a probability computed from a seeded score', () => {
    expect(() => lightningReliabilityService.simulateLiquidity({ target_pubkey: samplePubkey, amount_sats: 500000 }))
      .toThrow(unavailable('unavailable-pathfinder'));
  });

  it('rejects malformed identifiers before naming a source', () => {
    const invalid = expect.objectContaining({ code: 'invalid-input', status: 400 });
    expect(() => lightningReliabilityService.getNodeReliability('not-a-pubkey')).toThrow(invalid);
    expect(() => lightningReliabilityService.getChannelLifecycle('channel')).toThrow(invalid);
    expect(() => lightningReliabilityService.getClosureForensics('txid')).toThrow(invalid);
    expect(() => lightningReliabilityService.simulateLiquidity({ target_pubkey: samplePubkey, amount_sats: 0 })).toThrow(invalid);
  });

  it('never resolves an absent source as an empty directory', () => {
    for (const read of [
      () => lightningReliabilityService.getOverview(),
      () => lightningReliabilityService.getNodeReliability(samplePubkey),
      () => lightningReliabilityService.getChannelLifecycle('860400x120x0'),
      () => lightningReliabilityService.getClosureForensics('9f'.repeat(32)),
      () => lightningReliabilityService.getLspProviders(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(LightningReliabilityEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Lightning reliability HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): { gets: Map<string, Handler>; post: Handler } {
    const gets = new Map<string, Handler>();
    let post!: Handler;
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((_path: string, callback: Handler) => { post = callback; return app; }),
    };
    lightningReliabilityRoutes.initRoutes(app as unknown as Application);
    return { gets, post };
  }

  it('answers every observation read with a 503 that names the missing source', async () => {
    const { gets } = mount();
    expect(gets.size).toBe(5);
    const params = {
      pubkey: '03864ef025fde8fb587d989186ce6a4a186895ee44a926bfc370e2c366597a3f8f',
      shortId: '860400x120x0',
      txid: '9f'.repeat(32),
    };
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('top_reliable_nodes');
      expect(body).not.toHaveProperty('probes');
    }
  });

  it('answers a simulation with a 503 that names the pathfinder, and bad input with a 400', async () => {
    const { post } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await post({ body: { target_pubkey: '03'.padEnd(66, 'a'), amount_sats: 1000 } } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ stage: 'unavailable-pathfinder' }));

    const bad = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await post({ body: {} } as Request, bad as unknown as Response);
    expect(bad.status).toHaveBeenCalledWith(400);
    expect(bad.json).toHaveBeenCalledWith(expect.objectContaining({ stage: 'invalid-input' }));
  });
});
