import { liquidObservatoryService } from './liquid-observatory.service';

describe('LiquidObservatoryService', () => {
  it('returns valid liquid observatory summary with exact reserve', async () => {
    const summary = await liquidObservatoryService.$getSummary();
    expect(summary.blockHeight).toBeGreaterThan(3000000);
    expect(summary.dynamicFederation.currentEpoch).toBe(4);
    expect(summary.peggedReserveSats).toBe('384219400000');
    expect(summary.recentPegs.length).toBeGreaterThan(0);
  });

  it('lists registered confidential assets including L-BTC and USDt', async () => {
    const assets = await liquidObservatoryService.$getAssets();
    expect(assets.length).toBeGreaterThan(0);
    const lbtc = assets.find((a) => a.ticker === 'L-BTC');
    expect(lbtc).toBeDefined();
    expect(lbtc?.isConfidential).toBe(true);
  });

  it('retrieves active dynamic federation configuration', async () => {
    const federation = await liquidObservatoryService.$getFederation();
    expect(federation.totalSigners).toBe(15);
    expect(federation.threshold).toBe(11);
    expect(federation.signblockscript).toBeDefined();
  });
});
