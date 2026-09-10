import { Application, Request, Response } from 'express';
import bitcoinStakingRoutes from './bitcoin-staking.routes';
import bitcoinStakingService, { BitcoinStakingEvidenceError } from './bitcoin-staking.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: three finality providers with invented keys, three delegations
 * with invented txids, a parameter table with placeholder covenant keys, a
 * transaction verdict whose "detected" staking parameters were the same
 * constants for every input, and a reconciliation that matched by
 * construction. Passing those proved the constants were present, not that any
 * delegation had been observed.
 */
describe('BitcoinStakingService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing staking indexer rather than a directory of invented delegations', () => {
    expect(() => bitcoinStakingService.getOverview()).toThrow(unavailable('unavailable-staking-indexer'));
    expect(() => bitcoinStakingService.listDelegations()).toThrow(unavailable('unavailable-staking-indexer'));
    expect(() => bitcoinStakingService.listDelegations('active')).toThrow(unavailable('unavailable-staking-indexer'));
    expect(() => bitcoinStakingService.getDelegation('del-882001-allnodes')).toThrow(unavailable('unavailable-staking-indexer'));
    expect(() => bitcoinStakingService.listFinalityProviders()).toThrow(unavailable('unavailable-staking-indexer'));
    expect(() => bitcoinStakingService.getFinalityProvider('fp-allnodes-01')).toThrow(unavailable('unavailable-staking-indexer'));
    expect(() => bitcoinStakingService.listEvidence()).toThrow(unavailable('unavailable-staking-indexer'));
  });

  it('reports the missing parameter source rather than placeholder covenant keys', () => {
    expect(() => bitcoinStakingService.getParameters()).toThrow(unavailable('unavailable-staking-parameters'));
    expect(() => bitcoinStakingService.getParameter('babylon-mainnet-phase-1')).toThrow(unavailable('unavailable-staking-parameters'));
  });

  it('reports the missing consumer chain rather than a reconciliation that matches by construction', () => {
    expect(() => bitcoinStakingService.reconcileWithConsumerPoS('babylon-hub-1')).toThrow(unavailable('unavailable-consumer-chain'));
  });

  it('rejects malformed transaction hex and otherwise reports the missing staking parser', () => {
    const malformed = bitcoinStakingService.verifyTransaction({ raw_tx_hex: 'deadbeef', expected_family: 'staking_deposit' });
    expect(malformed.valid).toBe(false);
    expect(malformed.errors).toContain('Transaction hex is malformed or too short');

    const wellFormed = '0200000001' + '00'.repeat(32) + '0000000000fdffffff01' + '00e1f50500000000' + '160014' + '11'.repeat(20) + '00000000';
    expect(() => bitcoinStakingService.verifyTransaction({ raw_tx_hex: wellFormed, expected_family: 'staking_deposit' }))
      .toThrow(unavailable('unavailable-staking-parser'));
  });

  it('never resolves an absent source as an empty directory', () => {
    for (const read of [
      () => bitcoinStakingService.getOverview(),
      () => bitcoinStakingService.getParameters(),
      () => bitcoinStakingService.listDelegations(),
      () => bitcoinStakingService.listFinalityProviders(),
      () => bitcoinStakingService.listEvidence(),
      () => bitcoinStakingService.reconcileWithConsumerPoS('any'),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(BitcoinStakingEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });

  it('still rejects incomplete EOTS evidence packages', () => {
    const identical = bitcoinStakingService.verifySlashingEvidence({
      eots_pk: '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      nonce_point: '028888888888888888888888888888888888888888888888888888888888888888',
      message_a: 'same_message',
      message_b: 'same_message',
      signature_a: 'sig1',
      signature_b: 'sig2',
    });
    expect(identical.verified).toBe(false);
    expect(identical.status).toBe('invalid_evidence');
  });
});

describe('Bitcoin staking HTTP responses', () => {
  type Handler = (req: Request, res: Response) => void;

  function mount(): { gets: Map<string, Handler>; posts: Map<string, Handler> } {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((path: string, callback: Handler) => { posts.set(path, callback); return app; }),
    };
    bitcoinStakingRoutes.initRoutes(app as unknown as Application);
    return { gets, posts };
  }

  it('answers every observation read with a 503 that names the missing source', () => {
    const { gets } = mount();
    expect(gets.size).toBe(8);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      handler({ params: { versionId: 'v1', delegationId: 'del', providerId: 'fp' }, query: {} } as unknown as Request,
        res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('delegation_states_summary');
      expect(body).not.toHaveProperty('covenant_quorum');
    }
  });

  it('answers a reconciliation request with a 503 rather than a synchronized verdict', () => {
    const { posts } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    posts.get('/api/v1/intelligence/bitcoin-staking/reconcile')!(
      { body: { chain_name: 'babylon-hub-1' } } as unknown as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ stage: 'unavailable-consumer-chain' }));
  });
});
