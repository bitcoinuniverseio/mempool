import { l2ObservatoryService } from './l2-observatory.service';

describe('L2ObservatoryService', () => {
  it('returns active BitVM and L2 bridge systems with trust models', async () => {
    const systems = await l2ObservatoryService.$getSystems();
    expect(systems.length).toBeGreaterThan(0);
    const bitvm2 = systems.find((s) => s.id === 'bitvm2-permissionless');
    expect(bitvm2).toBeDefined();
    expect(bitvm2?.trustModel).toBe('1-of-n');
  });

  it('tracks challenge resolution and timeout windows', async () => {
    const challenges = await l2ObservatoryService.$getChallenges();
    expect(challenges.length).toBeGreaterThan(0);
    expect(challenges[0].assertionTxid).toHaveLength(64);
    expect(challenges[0].timeoutBlockHeight).toBeGreaterThan(0);
  });

  it('audits locked reserve UTXOs against reported L2 supplies', async () => {
    const audit = await l2ObservatoryService.$getReserveAudit('citrea-clementine');
    expect(audit).not.toBeNull();
    expect(audit?.reserveRatio).toBe('1.0000');
    expect(audit?.reserveOutpoints.length).toBeGreaterThan(0);
  });
});
