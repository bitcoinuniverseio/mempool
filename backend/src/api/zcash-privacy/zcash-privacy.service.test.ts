import { zcashPrivacyService } from './zcash-privacy.service';

describe('ZcashPrivacyService', () => {
  it('returns comprehensive privacy summary with exact pool balances', async () => {
    const summary = await zcashPrivacyService.$getSummary();
    expect(summary.tipHeight).toBeGreaterThan(2000000);
    expect(summary.pools.length).toBe(5);
    expect(summary.pools.some((p) => p.id === 'orchard')).toBe(true);
    expect(summary.pools.some((p) => p.id === 'sapling')).toBe(true);
    expect(summary.pools.some((p) => p.id === 'transparent')).toBe(true);
    expect(summary.recentFlows.length).toBeGreaterThan(0);
  });

  it('provides complete network upgrade history including NU5 and Halo 2', async () => {
    const upgrades = await zcashPrivacyService.$getUpgrades();
    expect(upgrades.length).toBe(6);
    const nu5 = upgrades.find((u) => u.name === 'NU5');
    expect(nu5).toBeDefined();
    expect(nu5?.branchId).toBe('0xc2d6d0b4');
    expect(nu5?.activationHeight).toBe(1687104);
  });
});
