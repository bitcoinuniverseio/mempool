import { Application, Request, Response } from 'express';
import nodeSecurityRoutes from './node-security.routes';
import nodeSecurityService, { NodeSecurityEvidenceError } from './node-security.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: releases with invented checksums that were signature-verified
 * because the constant said so, advisories with invented identifiers, a fleet
 * of three invented nodes of which one was exposed by construction, and an
 * upgrade plan that hopped through 26.2 whatever the input. Passing those
 * proved the constants were present, not that any node or release had been
 * observed.
 */
describe('NodeSecurityService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing release manifest rather than releases that claim to be signed', () => {
    expect(() => nodeSecurityService.listReleases()).toThrow(unavailable('unavailable-release-manifest'));
    expect(() => nodeSecurityService.listArtifacts()).toThrow(unavailable('unavailable-release-manifest'));
  });

  it('reports the missing advisory feed rather than advisories that claim to be PGP-verified', () => {
    expect(() => nodeSecurityService.listAdvisories()).toThrow(unavailable('unavailable-advisory-feed'));
    expect(() => nodeSecurityService.getAdvisory('BIP-SEC-2024-01')).toThrow(unavailable('unavailable-advisory-feed'));
  });

  it('reports the missing fleet inventory rather than invented nodes, exposures and plans', () => {
    expect(() => nodeSecurityService.getOverview()).toThrow(unavailable('unavailable-fleet-inventory'));
    expect(() => nodeSecurityService.listFleet()).toThrow(unavailable('unavailable-fleet-inventory'));
    expect(() => nodeSecurityService.getNode('node-legacy-archive-03')).toThrow(unavailable('unavailable-fleet-inventory'));
    expect(() => nodeSecurityService.getNodeExposures('node-legacy-archive-03')).toThrow(unavailable('unavailable-fleet-inventory'));
    expect(() => nodeSecurityService.createUpgradePlan({ from_version: '24.0.1', target_version: '28.0' }))
      .toThrow(unavailable('unavailable-fleet-inventory'));
  });

  it('never resolves an absent source as an empty directory', () => {
    for (const read of [
      () => nodeSecurityService.listReleases(),
      () => nodeSecurityService.listAdvisories(),
      () => nodeSecurityService.listFleet(),
      () => nodeSecurityService.listArtifacts(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(NodeSecurityEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });

  it('still refuses to verify an artifact without an authenticated manifest', () => {
    expect(nodeSecurityService.verifyArtifact({ sha256: 'ab'.repeat(32), version: '28.0' }))
      .toMatchObject({ verified: false, state: 'unverified', stage: 'unavailable-manifest' });
    expect(nodeSecurityService.verifyArtifact({ sha256: 'bad_hash' }))
      .toMatchObject({ verified: false, stage: 'invalid-input' });
  });
});

describe('Node security HTTP responses', () => {
  type Handler = (req: Request, res: Response) => void;

  function mount(): { gets: Map<string, Handler>; posts: Map<string, Handler> } {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((path: string, callback: Handler) => { posts.set(path, callback); return app; }),
    };
    nodeSecurityRoutes.initRoutes(app as unknown as Application);
    return { gets, posts };
  }

  it('answers every observation read with a 503 that names the missing source', () => {
    const { gets, posts } = mount();
    expect(gets.size).toBe(8);
    const upgradePlan = posts.get('/api/v1/intelligence/node-security/upgrade-plans') as Handler;
    for (const handler of [...gets.values(), upgradePlan]) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      handler({ params: { advisoryId: 'a', nodeId: 'n' }, body: { from_version: '24.0.1', target_version: '28.0' } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('releases');
      expect(body).not.toHaveProperty('fleet');
      expect(body).not.toHaveProperty('canary_stages');
    }
  });
});
