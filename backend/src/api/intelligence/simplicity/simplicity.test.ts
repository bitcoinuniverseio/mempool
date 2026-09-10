import { Application, Request, Response } from 'express';
import simplicityRoutes from './simplicity.routes';
import simplicityService, { SimplicityEvidenceError } from './simplicity.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: two programs with invented Merkle roots, an occurrence in an
 * invented Liquid block, and a three-step execution trace for one hard-coded
 * txid. Passing those proved the constants were present, not that any program
 * had been observed.
 */
describe('SimplicityService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing program index rather than a directory of invented programs', () => {
    expect(() => simplicityService.getOverview()).toThrow(unavailable('unavailable-program-index'));
    expect(() => simplicityService.listPrograms()).toThrow(unavailable('unavailable-program-index'));
    expect(() => simplicityService.getProgram('prog-vault-clawback-v1')).toThrow(unavailable('unavailable-program-index'));
    expect(() => simplicityService.getProgramOccurrences('prog-vault-clawback-v1')).toThrow(unavailable('unavailable-program-index'));
  });

  it('reports the missing program index rather than deciding a transaction has no Simplicity', () => {
    expect(() => simplicityService.getTransaction('ab'.repeat(32))).toThrow(unavailable('unavailable-program-index'));
  });

  it('reports the missing toolchain registry rather than an invented toolchain', () => {
    expect(() => simplicityService.listToolchains()).toThrow(unavailable('unavailable-toolchain-registry'));
  });

  it('reports the missing runtime rather than a constant execution result', () => {
    expect(() => simplicityService.executeProgram({ program_bytes_hex: '0102030405060708', witness_hex: '' }))
      .toThrow(unavailable('unavailable-runtime'));
    expect(simplicityService.executeProgram({ program_bytes_hex: '', witness_hex: '' }))
      .toMatchObject({ success: false, errors: ['Program bytes are required'] });
  });

  it('never resolves an absent source as an empty directory', () => {
    for (const read of [
      () => simplicityService.getOverview(),
      () => simplicityService.listPrograms(),
      () => simplicityService.getProgramOccurrences('any'),
      () => simplicityService.getTransaction('ab'.repeat(32)),
      () => simplicityService.listToolchains(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(SimplicityEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });

  it('still rejects malformed decode and formal-artifact inputs', () => {
    const invalid = simplicityService.decodeProgram('01');
    expect(invalid.success).toBe(false);
    expect(invalid.errors).toContain('Simplicity program bytes too short or empty');

    const artifact = simplicityService.verifyFormalArtifact({
      schema_version: '1.0.0',
      program_cmr: '9b3e18cf9410ea82b405f63901a88b5601235123992019485123491823019283',
      source_hash: 'hash',
      compiler_revision: '0.1',
      libSimplicity_revision: '0.1',
      proof_system: 'custom_prover' as any,
      proof_source_hash: 'hash',
      proof_artifact_hash: 'hash',
      statement: 'statement',
      dependencies: [],
      verification_command: 'exec',
    });
    expect(artifact.verified).toBe(false);
    expect(artifact.proof_state).toBe('proof_failed');
  });
});

describe('Simplicity HTTP responses', () => {
  type Handler = (req: Request, res: Response) => void;

  function mount(): { gets: Map<string, Handler>; posts: Map<string, Handler> } {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((path: string, callback: Handler) => { posts.set(path, callback); return app; }),
    };
    simplicityRoutes.initRoutes(app as unknown as Application);
    return { gets, posts };
  }

  it('answers every observation read with a 503 that names the missing source', () => {
    const { gets } = mount();
    expect(gets.size).toBe(6);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      handler({ params: { programId: 'prog', txid: 'ab'.repeat(32) } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('executions');
      expect(body).not.toHaveProperty('recent_programs');
    }
  });

  it('answers an execution request with a 503 rather than a constant trace', () => {
    const { posts } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    posts.get('/api/v1/intelligence/simplicity/programs/execute')!(
      { body: { program_bytes_hex: '0102030405060708', witness_hex: '' } } as unknown as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ stage: 'unavailable-runtime' }));
  });
});

describe('Simplicity decoding verdicts', () => {
  it('never returns commitments or jets for a program without the owned decoder', () => {
    expect(() => simplicityService.decodeProgram('c8'.repeat(16))).toThrow(expect.objectContaining({ code: 'unavailable-decoder', status: 503 }));
  });
});
