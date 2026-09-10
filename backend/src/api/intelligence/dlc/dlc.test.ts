import { Application, Request, Response } from 'express';
import dlcRoutes from './dlc.routes';
import dlcService, { DlcEvidenceError } from './dlc.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: two healthy oracles nobody probed, an equivocation proof nobody
 * produced, and a settlement simulation whose funding transaction was fixed
 * hex. Passing those proved the constants were present, not that any oracle
 * had been observed.
 */
describe('DlcService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing oracle registry rather than a directory of invented oracles', () => {
    expect(() => dlcService.getOverview()).toThrow(unavailable('unavailable-oracle-registry'));
    expect(() => dlcService.listOracles()).toThrow(unavailable('unavailable-oracle-registry'));
    expect(() => dlcService.getOracle('oracle-kormir-alpha')).toThrow(unavailable('unavailable-oracle-registry'));
    expect(() => dlcService.getOracleHistory('oracle-kormir-alpha')).toThrow(unavailable('unavailable-oracle-registry'));
    expect(() => dlcService.listEvents()).toThrow(unavailable('unavailable-oracle-registry'));
    expect(() => dlcService.getEvent('bitcoin-difficulty-period-42')).toThrow(unavailable('unavailable-oracle-registry'));
    expect(() => dlcService.getEventAttestations('bitcoin-difficulty-period-42')).toThrow(unavailable('unavailable-oracle-registry'));
    expect(() => dlcService.listConflicts()).toThrow(unavailable('unavailable-oracle-registry'));
  });

  it('reports the missing regtest harness rather than a simulation with fixed transaction hex', () => {
    expect(() => dlcService.createSimulation({ scenario: 'settlement', contract_id: 'contract-test-01', oracle_ids: [] }))
      .toThrow(unavailable('unavailable-dlc-simulator'));
    expect(() => dlcService.getSimulation('sim-1')).toThrow(unavailable('unavailable-dlc-simulator'));
  });

  it('never resolves an absent source as an empty directory', () => {
    for (const read of [
      () => dlcService.getOverview(),
      () => dlcService.listOracles(),
      () => dlcService.getOracleHistory('oracle-kormir-alpha'),
      () => dlcService.listEvents(),
      () => dlcService.getEventAttestations('bitcoin-difficulty-period-42'),
      () => dlcService.listConflicts(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(DlcEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });

  it('still checks the structure of a caller-supplied announcement and rejects duplicate nonces', () => {
    const valid = dlcService.verifyAnnouncement({
      oracle_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      event_id: 'test-event-01',
      event_descriptor: { type: 'enumerated', outcomes: ['win', 'loss'] },
      event_maturity_epoch: 1788500000,
      nonces: ['02e07174624d775191c0e0b3f5115291d92a4a350a4179373f1d3a5a7849e7b235'],
      announcement_signature: '72a6b22b10298a0c5c4f24fef7d8b584a7e937d5718a209b0b4a7be6c7a918e9324bc6885dfb2e59fa257f8cf28e5784931a7c36e4f3a743b174780614cf12c5',
    });
    expect(valid.verified).toBe(true);
    expect(valid.errors.length).toBe(0);

    const invalid = dlcService.verifyAnnouncement({
      oracle_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      event_id: 'test-event-02',
      event_descriptor: { type: 'enumerated', outcomes: ['win', 'loss'] },
      event_maturity_epoch: 1788500000,
      nonces: [
        '02e07174624d775191c0e0b3f5115291d92a4a350a4179373f1d3a5a7849e7b235',
        '02e07174624d775191c0e0b3f5115291d92a4a350a4179373f1d3a5a7849e7b235',
      ],
      announcement_signature: 'sig',
    });
    expect(invalid.verified).toBe(false);
    expect(invalid.errors).toContain('Duplicate nonce points detected in announcement');
  });

  it('still checks a caller-supplied contract package for collateral conservation', () => {
    const validPkg = dlcService.verifyContractPackage({
      parties: [
        {
          role: 'local',
          public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
          collateral_sats: 100000,
          payout_address: 'bc1q...',
          funding_input: { txid: '00'.repeat(32), vout: 0, value_sats: 100000 },
        },
        {
          role: 'remote',
          public_key: '03c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
          collateral_sats: 100000,
          payout_address: 'bc1q...',
          funding_input: { txid: '11'.repeat(32), vout: 0, value_sats: 100000 },
        },
      ],
      cets: [
        {
          cet_id: 'cet-1',
          outcome: 'win',
          local_payout_sats: 198000,
          remote_payout_sats: 0,
          fee_sats: 2000,
          adaptor_signature: 'sig-adaptor-1',
          locktime: 860500,
        },
      ],
      refund: {
        locktime: 861000,
        local_payout_sats: 99000,
        remote_payout_sats: 99000,
      },
    });
    expect(validPkg.valid).toBe(true);
    expect(validPkg.total_collateral_sats).toBe(200000);

    const invalidPkg = dlcService.verifyContractPackage({
      parties: [
        {
          role: 'local',
          public_key: 'pub1',
          collateral_sats: 100000,
          payout_address: 'bc1q...',
          funding_input: { txid: '00'.repeat(32), vout: 0, value_sats: 100000 },
        },
      ],
    });
    expect(invalidPkg.valid).toBe(false);
    expect(invalidPkg.errors).toContain('DLC contract package requires exactly two parties');
  });
});

describe('DLC HTTP responses', () => {
  type Handler = (req: Request, res: Response) => unknown;

  function mount(): { gets: Map<string, Handler>; posts: Map<string, Handler> } {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((path: string, callback: Handler) => { posts.set(path, callback); return app; }),
    };
    dlcRoutes.initRoutes(app as unknown as Application);
    return { gets, posts };
  }

  it('answers every observation read with a 503 that names the missing source', async () => {
    const { gets } = mount();
    expect(gets.size).toBe(9);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { oracleId: 'oracle-1', eventId: 'event-1', simulationId: 'sim-1' } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('recent_events');
      expect(Array.isArray(body)).toBe(false);
    }
  });

  it('answers a simulation request with a 503 that names the regtest harness', async () => {
    const { posts } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await posts.get('/api/v1/intelligence/dlc/simulations')!({ body: { scenario: 'settlement', contract_id: 'c', oracle_ids: [] } } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ stage: 'unavailable-dlc-simulator' }));
  });
});
